// Pocket Cockpit (v0.3 Phase 1) unit tests: classification, away mode,
// delta counters, contract, and the host aggregator with a fake DSH context.
// Run: node --test test/cockpit.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { classifySession, hasPendingApproval, hasOpenTurn, lastTurnEndReason } from '../lib/cockpit/classify.js'
import { computeDelta } from '../lib/cockpit/delta.js'
import { loadAwayState, startAway, stopAway, defaultAwayFile } from '../lib/cockpit/away.js'
import {
  STATUS, makeSessionDTO, hasCapability, DEFAULT_DEVICE_CAPABILITIES,
  normalizeAwayState, awaySinceMs,
} from '../lib/cockpit/contract.js'
import { createCockpitService } from '../lib/cockpit/service.js'

// ------------------------------------------------------------ event helpers

const t0 = Date.UTC(2026, 7, 16, 8, 0, 0)
const ev = (type, data, time = t0, seq = 0) => ({ seq, type, time, data })
const turnStart = (turn = 1, time = t0) => ev('turn/start', { turn }, time)
const turnEnd = (reason, turn = 1, time = t0 + 1000) => ev('turn/end', { turn, reason: { kind: reason } }, time)
const toolCall = (name, args = '{}', time = t0) => ev('tool/call', { name, arguments: args }, time)
const approvalAsked = (id = 'a1', time = t0) => ev('approval/asked', { id, toolName: 'bash' }, time)
const approvalDecided = (id = 'a1', outcome = 'allowed-once', time = t0 + 500) => ev('approval/decided', { id, outcome }, time)

// ------------------------------------------------------------ classification

test('cockpit classify: running session -> RUNNING (open turn)', () => {
  const events = [turnStart(1), toolCall('bash'), turnEnd('completed', 1)]
  // completed turn closed -> FINISHED; a NEW open turn -> RUNNING
  const running = [turnStart(1), turnEnd('completed', 1), turnStart(2)]
  assert.equal(classifySession(running), STATUS.RUNNING)
  assert.equal(classifySession(events), STATUS.FINISHED)
  assert.equal(hasOpenTurn(running), true)
})

test('cockpit classify: finished session -> FINISHED', () => {
  const events = [turnStart(1), turnEnd('completed', 1)]
  assert.equal(classifySession(events), STATUS.FINISHED)
  assert.equal(lastTurnEndReason(events), 'completed')
})

test('cockpit classify: failed session -> FAILED (last turn error)', () => {
  const events = [turnStart(1), turnEnd('error', 1)]
  assert.equal(classifySession(events), STATUS.FAILED)
})

test('cockpit classify: pending approval -> NEEDS_ATTENTION (highest priority)', () => {
  // asked without decided = blocked
  const blocked = [turnStart(1), approvalAsked('a1'), toolCall('bash')]
  assert.equal(hasPendingApproval(blocked), true)
  assert.equal(classifySession(blocked), STATUS.NEEDS_ATTENTION)
  // asked + decided = no longer blocked
  const resolved = [turnStart(1), approvalAsked('a1'), approvalDecided('a1'), toolCall('bash'), turnEnd('completed', 1)]
  assert.equal(hasPendingApproval(resolved), false)
  assert.equal(classifySession(resolved), STATUS.FINISHED)
})

test('cockpit classify: empty / aborted / blocked / interrupted -> IDLE', () => {
  assert.equal(classifySession([]), STATUS.IDLE)
  assert.equal(classifySession([turnStart(1), turnEnd('aborted', 1)]), STATUS.IDLE)
  assert.equal(classifySession([turnStart(1), turnEnd('interrupted', 1)]), STATUS.IDLE)
})

test('cockpit classify: live agent hint -> RUNNING even without open turn', () => {
  assert.equal(classifySession([turnStart(1), turnEnd('completed', 1)], { liveAgent: true }), STATUS.RUNNING)
})

test('cockpit classify: empty session with live agent -> RUNNING', () => {
  assert.equal(classifySession([], { liveAgent: true }), STATUS.RUNNING)
})

// ------------------------------------------------------------ away mode

test('cockpit away: start stores awaySince, stop clears state', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp-cockpit-'))
  const file = path.join(dir, 'pocket-away.json')
  try {
    const before = await loadAwayState(file)
    assert.equal(before.away, false)
    const start = await startAway(file, new Date('2026-08-16T15:30:00+09:00'))
    assert.equal(start.away, true)
    assert.equal(start.awaySince, '2026-08-16T06:30:00.000Z')
    const loaded = await loadAwayState(file)
    assert.equal(loaded.away, true)
    assert.equal(loaded.awaySince, '2026-08-16T06:30:00.000Z')
    const stop = await stopAway(file)
    assert.equal(stop.away, false)
    assert.equal(stop.awaySince, null)
    assert.equal((await loadAwayState(file)).away, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cockpit away: missing/corrupt file fails closed (not away)', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp-cockpit-'))
  const file = path.join(dir, 'pocket-away.json')
  try {
    assert.equal((await loadAwayState(path.join(dir, 'missing.json'))).away, false)
    await (await import('node:fs/promises')).writeFile(file, '{ not json', 'utf8')
    assert.equal((await loadAwayState(file)).away, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cockpit away: default file lives in the project profile state dir, NOT the security store', () => {
  const f = defaultAwayFile()
  assert.ok(f.includes('.dsh') && f.includes('profiles') && f.includes('web'))
  assert.ok(!f.includes('remfs-security.json'), 'away state must not live in the security store')
})

// ------------------------------------------------------------ delta

test('cockpit delta: counts tool calls, file changes, errors, approvals, test runs since awaySince', () => {
  const events = [
    toolCall('write', '{"path":"C:\\\\a\\\\b.js"}', t0),
    toolCall('bash', '{"command":"node --test"}', t0 + 1000),
    toolCall('edit', '{"path":"C:\\\\a\\\\b.js"}', t0 + 2000),
    { ...ev('tool/result', { error: { name: 'E', code: 'E' } }, t0 + 3000) },
    approvalAsked('a1', t0 + 4000),
    approvalDecided('a1', 'allowed-once', t0 + 4500),
    turnStart(1, t0 + 5000),
    turnEnd('completed', 1, t0 + 6000),
  ]
  const all = computeDelta(events, 0)
  assert.equal(all.toolCalls, 3)
  assert.equal(all.filesChanged, 2) // write + edit
  assert.equal(all.errors, 1) // tool/result error
  assert.equal(all.approvals, 1)
  assert.equal(all.testRuns, 1) // bash "node --test"
  // since awaySince (t0 + 1500): only edit (t0+2000), tool/result error
  // (t0+3000), approvals (t0+4000) fall after the window; write+bash are before
  const since = computeDelta(events, t0 + 1500)
  assert.equal(since.toolCalls, 1)
  assert.equal(since.filesChanged, 1)
  assert.equal(since.errors, 1)
  assert.equal(since.approvals, 1)
  assert.equal(since.testRuns, 0)
})

test('cockpit delta: empty log -> zero counters, hasEvents false', () => {
  const d = computeDelta([], 0)
  assert.deepEqual(d, { filesChanged: 0, toolCalls: 0, errors: 0, approvals: 0, testRuns: 0, hasEvents: false })
})

// ------------------------------------------------------------ contract

test('cockpit contract: makeSessionDTO is stable and defaulted', () => {
  const dto = makeSessionDTO({ sessionId: 's1', status: STATUS.RUNNING, startedAt: 1, lastActivityAt: 2, lastAction: { type: 'tool', name: 'bash', summary: 'bash x' } })
  assert.equal(dto.sessionId, 's1')
  assert.equal(dto.status, STATUS.RUNNING)
  assert.equal(dto.title, 'Untitled')
  assert.deepEqual(dto.delta, { filesChanged: 0, toolCalls: 0, errors: 0 })
  const empty = makeSessionDTO({})
  assert.equal(empty.status, STATUS.IDLE)
  assert.equal(empty.lastAction, null)
})

test('cockpit contract: capabilities default to files+cockpit+approval; hasCapability gates', () => {
  assert.deepEqual(DEFAULT_DEVICE_CAPABILITIES, ['files', 'cockpit', 'approval'])
  // legacy device (no capabilities field) gets all defaults
  assert.equal(hasCapability(undefined, 'files'), true)
  assert.equal(hasCapability(undefined, 'cockpit'), true)
  assert.equal(hasCapability([], 'cockpit'), true)
  // explicit narrowing
  assert.equal(hasCapability(['files'], 'cockpit'), false)
  assert.equal(hasCapability(['files', 'cockpit'], 'approval'), false)
})

test('cockpit contract: away state normalization fails closed', () => {
  assert.deepEqual(normalizeAwayState(null), { away: false, awaySince: null })
  assert.deepEqual(normalizeAwayState({ away: true }), { away: false, awaySince: null })
  assert.deepEqual(normalizeAwayState({ away: false, awaySince: 'x' }), { away: false, awaySince: null })
  assert.equal(awaySinceMs('2026-08-16T06:30:00.000Z') > 0, true)
  assert.equal(awaySinceMs(null), 0)
})

// ------------------------------------------------------------ aggregator

/** Fake DSH context with sessionQuery/sessions/agents/workspaceRegistry. */
function fakeCtx({ records, eventsBySession, liveIds = [], ws = [] }) {
  const ctx = {
    get(name) {
      switch (name) {
        case 'sessionQuery': return {
          listSessions: async () => records.slice(),
          listEvents: async (id) => (eventsBySession[id] || []).slice(),
          readTitle: async () => undefined,
        }
        case 'sessions': return { list: () => liveIds.map((id) => ({ id })) }
        case 'agents': return { list: () => liveIds.map((id) => ({ id, sessionId: id })) }
        case 'workspaceRegistry': return { list: () => ws.map((w) => ({ ...w })) }
        default: return undefined
      }
    },
  }
  return ctx
}

test('cockpit service: aggregates and classifies sessions, sorted NEEDS_ATTENTION first', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp-cockpit-'))
  const awayFile = path.join(dir, 'pocket-away.json')
  try {
    const ctx = fakeCtx({
      records: [
        { id: 's-finished', header: { createdAt: t0, cwd: 'C:\\ws1' } },
        { id: 's-running', header: { createdAt: t0 } },
        { id: 's-blocked', header: { createdAt: t0 } },
        { id: 's-failed', header: { createdAt: t0 } },
      ],
      eventsBySession: {
        's-finished': [turnStart(1, t0), turnEnd('completed', 1, t0 + 1000)],
        's-running': [turnStart(1, t0), turnStart(2, t0 + 1000)],
        's-blocked': [turnStart(1, t0), approvalAsked('a1', t0 + 100), toolCall('bash', '{"command":"ls"}', t0 + 200)],
        's-failed': [turnStart(1, t0), turnEnd('error', 1, t0 + 1000)],
      },
      ws: [{ id: 'w1', path: 'C:\\ws1' }],
    })
    const svc = createCockpitService(ctx, { awayFile })
    const res = await svc.sessions()
    assert.equal(res.ok, true)
    const order = res.value.sessions.map((s) => s.sessionId)
    assert.deepEqual(order, ['s-blocked', 's-running', 's-failed', 's-finished'])
    const byId = Object.fromEntries(res.value.sessions.map((s) => [s.sessionId, s]))
    assert.equal(byId['s-blocked'].status, STATUS.NEEDS_ATTENTION)
    assert.equal(byId['s-blocked'].attention.kind, 'approval')
    assert.equal(byId['s-running'].status, STATUS.RUNNING)
    assert.equal(byId['s-failed'].status, STATUS.FAILED)
    assert.equal(byId['s-finished'].status, STATUS.FINISHED)
    assert.equal(byId['s-blocked'].lastAction.type, 'tool')
    assert.equal(byId['s-blocked'].lastAction.summary, 'bash ls')
    assert.equal(byId['s-finished'].workspacePath, 'C:\\ws1')
    assert.equal(byId['s-finished'].workspaceId, null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cockpit service: away start/stop wired through status; delta uses awaySince', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp-cockpit-'))
  const awayFile = path.join(dir, 'pocket-away.json')
  try {
    const ctx = fakeCtx({
      records: [{ id: 's1', header: { createdAt: t0 } }],
      eventsBySession: {
        's1': [turnStart(1, t0), toolCall('write', '{"path":"x"}', t0 + 100), turnEnd('completed', 1, t0 + 200)],
      },
    })
    const svc = createCockpitService(ctx, { awayFile })
    const st0 = await svc.status({ capabilities: ['files', 'cockpit'] })
    assert.equal(st0.ok, true)
    assert.equal(st0.value.away, false)
    const start = await svc.awayStart()
    assert.equal(start.value.away, true)
    // delta window: everything before awaySince excluded
    await startAway(awayFile, new Date(t0 + 150))
    const sessions = await svc.sessions()
    assert.equal(sessions.value.sessions[0].delta.toolCalls, 0) // all events before awaySince
    const stop = await svc.awayStop()
    assert.equal(stop.value.away, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cockpit service: sessionQuery unavailable -> fails closed with error', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp-cockpit-'))
  const awayFile = path.join(dir, 'pocket-away.json')
  try {
    const svc = createCockpitService({ get: () => undefined }, { awayFile })
    const res = await svc.sessions()
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'capability-unavailable')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
