// Agent Presence Phase C (Dogfood): the CLI board must derive the SAME state
// the live service derives (single source of truth, design §25) when reading
// REAL session-log files. These tests synthesize multi-frame zstd session
// logs (same container DSH writes: concatenated frames, checksummed) and
// assert the dogfood board's frame scanning + aggregation.
// Run: node --test test/dogfood.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { constants, zstdCompressSync } from 'node:zlib'
import path from 'node:path'
import os from 'node:os'

import { STATE } from '../lib/presence/contract.js'
import { scanZstdFrames, loadSessionFile, loadSessionsDir, buildTasks } from '../scripts/dogfood-board.js'

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

function frame(lines) {
  return zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), CHECKSUM)
}

/** Build a synthetic session log buffer (header frame + one events frame). */
function sessionLog(header, events) {
  return Buffer.concat([frame([JSON.stringify(header)]), frame(events.map((e) => JSON.stringify(e)))])
}

function ev(type, data, time, seq = 0) {
  return { seq, type, time, data }
}

// ------------------------------------------------------------ frame scanning

test('dogfood: scanZstdFrames splits concatenated checksummed frames', () => {
  const b1 = frame(['{"a":1}'])
  const b2 = frame(['{"b":2}', '{"b":3}'])
  const b3 = frame(['{"c":4}'])
  const buf = Buffer.concat([b1, b2, b3])
  const { frames } = scanZstdFrames(buf)
  assert.equal(frames.length, 3)
  assert.deepEqual(frames.map((f) => f.start), [0, b1.length, b1.length + b2.length])
  // each frame decompresses to its own lines
  const parts = frames.map((f) => Buffer.from(buf.subarray(f.start, f.end)).toString('latin1'))
  assert.ok(parts[0].length > 0)
})

test('dogfood: loadSessionFile extracts header and event records', async () => {
  const header = { type: 'session', id: 's1', createdAt: Date.now(), cwd: 'C:\\ws' }
  const log = sessionLog(header, [
    ev('turn/start', { turn: 1 }, header.createdAt + 100),
    ev('tool/result', { name: 'bash', message: { content: 'ok' } }, header.createdAt + 200),
  ])
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dogfood-'))
  try {
    const file = path.join(dir, 'session.jsonl.zstd')
    await writeFile(file, log)
    const { events, header: h } = loadSessionFile(file)
    assert.equal(h.id, 's1')
    assert.equal(events.length, 2)
    assert.equal(events[0].type, 'turn/start')
    assert.equal(events[1].type, 'tool/result')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dogfood: loadSessionsDir scans a workspace tree', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dogfood-dir-'))
  try {
    const ws = path.join(dir, '--C-Users-zeta-Documents--')
    const s1 = path.join(ws, 'session-a')
    const s2 = path.join(ws, 'session-b')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(s1, { recursive: true })
    await mkdir(s2, { recursive: true })
    const now = Date.now()
    await writeFile(path.join(s1, 'session.jsonl.zstd'), sessionLog(
      { type: 'session', id: 'session-a', createdAt: now },
      [ev('turn/start', { turn: 1 }, now), ev('tool/result', { name: 'bash', message: { content: 'ok' } }, now + 100)],
    ))
    await writeFile(path.join(s2, 'session.jsonl.zstd'), sessionLog(
      { type: 'session', id: 'session-b', createdAt: now },
      [ev('turn/start', { turn: 1 }, now), ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, now + 200)],
    ))
    const sessions = loadSessionsDir(dir)
    assert.equal(sessions.length, 2)
    const ids = sessions.map((s) => s.sessionId).sort()
    assert.deepEqual(ids, ['session-a', 'session-b'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ------------------------------------------------------------ state derivation

function mkSession(id, events, createdAt) {
  return {
    sessionId: id,
    workspaceDir: '--C-Users-zeta-Documents--',
    file: '',
    events,
    header: { type: 'session', id, createdAt },
  }
}

test('dogfood: buildTasks derives RUNNING for an open turn with fresh progress', () => {
  const now = Date.now()
  const tasks = buildTasks([mkSession('s-run', [
    ev('turn/start', { turn: 1 }, now - 1000),
    ev('tool/result', { name: 'bash', message: { content: 'ok' } }, now - 500),
  ], now - 2000)], { now, liveIds: ['s-run'] })
  assert.equal(tasks[0].state, STATE.RUNNING)
})

test('dogfood: buildTasks derives STALE + explainable reason, then recovery', () => {
  const now = Date.now()
  const past = now - 21 * 60 * 1000
  const base = [
    ev('turn/start', { turn: 1 }, past),
    ev('tool/result', { name: 'bash', message: { content: 'ok' } }, past + 500),
  ]
  // The agent claims running (live session) but produced no meaningful
  // progress for 21m. Offline scans assume the engine is alive (the scan is
  // proof the host runs), so no chunk hack is needed to keep a system
  // heartbeat fresh - the system heartbeat is engine liveness, never the
  // last event time.
  const tasks1 = buildTasks([mkSession('s-stale', base, past)], { now, liveIds: ['s-stale'] })
  assert.equal(tasks1[0].state, STATE.STALE)
  assert.ok(tasks1[0].staleReason && tasks1[0].staleReason.length > 0,
    'STALE must carry explainable facts: ' + JSON.stringify(tasks1[0].staleReason))
  // fresh meaningful progress (different tool+args) recovers to RUNNING
  const recovered = [...base, ev('tool/result', { name: 'edit', arguments: '{"path":"new.txt"}' }, now - 500)]
  const tasks2 = buildTasks([mkSession('s-stale', recovered, past)], { now, liveIds: ['s-stale'] })
  assert.equal(tasks2[0].state, STATE.RUNNING)
})

test('dogfood: buildTasks derives FAILED only from a CLOSED error turn', () => {
  const now = Date.now()
  // open turn with one tool error -> RUNNING (agent may recover)
  const open = buildTasks([mkSession('s-open', [
    ev('turn/start', { turn: 1 }, now - 1000),
    ev('tool/result', { name: 'pwsh', error: { code: '1' } }, now - 500),
  ], now - 2000)], { now, liveIds: ['s-open'] })
  assert.equal(open[0].state, STATE.RUNNING)
  // closed error turn -> FAILED
  const closed = buildTasks([mkSession('s-fail', [
    ev('turn/start', { turn: 1 }, now - 1000),
    ev('tool/result', { name: 'pwsh', error: { code: '1' } }, now - 500),
    ev('turn/end', { turn: 1, reason: { kind: 'error' } }, now - 100),
  ], now - 2000)])
  assert.equal(closed[0].state, STATE.FAILED)
})

test('dogfood: buildTasks derives DONE / IDLE / DISCONNECTED', () => {
  const now = Date.now()
  const done = buildTasks([mkSession('s-done', [
    ev('turn/start', { turn: 1 }, now - 2000),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, now - 1000),
  ], now - 3000)], { now })
  assert.equal(done[0].state, STATE.DONE)
  const idle = buildTasks([mkSession('s-idle', [
    ev('sandbox/mode', { mode: 'safe' }, now - 1000),
  ], now - 2000)], { now })
  assert.equal(idle[0].state, STATE.IDLE)
  // ORPHANED open turn: turn/start that never closed, the session is not
  // live, and the log has been silent past the system TTL - the per-session
  // loop is gone, so DISCONNECTED (the live service derives the same way).
  const dead = buildTasks([mkSession('s-dead', [
    ev('turn/start', { turn: 1 }, now - 70 * 60 * 1000),
    ev('tool/result', { name: 'bash', message: { content: 'ok' } }, now - 69 * 60 * 1000),
  ], now - 70 * 60 * 1000)], { now })
  assert.equal(dead[0].state, STATE.DISCONNECTED)
})

test('dogfood: tasks sort by state priority (FAILED above RUNNING)', () => {
  const now = Date.now()
  const tasks = buildTasks([
    mkSession('s-run', [
      ev('turn/start', { turn: 1 }, now - 1000),
      ev('tool/result', { name: 'bash', message: { content: 'ok' } }, now - 500),
    ], now - 2000),
    mkSession('s-fail', [
      ev('turn/start', { turn: 1 }, now - 1000),
      ev('turn/end', { turn: 1, reason: { kind: 'error' } }, now - 100),
    ], now - 2000),
  ], { now, liveIds: ['s-run'] })
  assert.equal(tasks[0].state, STATE.FAILED)
  assert.equal(tasks[1].state, STATE.RUNNING)
})

test('dogfood: stale-min flag is honored (10m threshold)', () => {
  const now = Date.now()
  const tasks = buildTasks([mkSession('s-stale10', [
    ev('turn/start', { turn: 1 }, now - 11 * 60 * 1000),
    ev('tool/result', { name: 'bash', message: { content: 'ok' } }, now - 11 * 60 * 1000 + 500),
  ], now - 12 * 60 * 1000)], { now, staleMinutes: 10, liveIds: ['s-stale10'] })
  assert.equal(tasks[0].state, STATE.STALE)
})
