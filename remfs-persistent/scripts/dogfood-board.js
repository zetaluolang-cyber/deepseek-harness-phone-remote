// scripts/dogfood-board.js — Agent Presence Phase C (Dogfood) CLI.
//
// Reads the REAL persisted session logs (~/.dsh/sessions by default) and runs
// the SAME presence derivation the live service uses (single source of truth,
// design §25): heartbeat folding, state resolution, summaries, stale reasons.
// The UI and this CLI therefore can never disagree about a task's state.
//
// Usage:
//   node scripts/dogfood-board.js [--sessions <dir>] [--stale-min 10|20|30]
//                                 [--json] [--max <n>]
//
// The core functions are exported so CI can test them against synthesized
// session logs (test/dogfood.test.js).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

import { foldHeartbeats, effectiveSystemAliveAt } from '../lib/presence/heartbeat.js'
import { resolveState } from '../lib/presence/state.js'
import { summarize, staleReasonLines } from '../lib/presence/summary.js'
import {
  STATE, STATE_PRIORITY, STATE_LABEL, makeTaskDTO, normalizeStaleMs,
  highestPriorityTask,
} from '../lib/presence/contract.js'
import {
  hasPendingApproval, terminalFailure, completed, agentRunning, hasOpenTurn,
  titleFromEvents, fileChangeCount, userTurnCount, firstTime, lastTime,
} from '../lib/presence/service.js'

const ZSTD_MAGIC = 4247762216 // 0xFD2FB528

/**
 * Locate complete zstd frame ranges (same algorithm as DSH's
 * dsh-session-persistence-jsonl scanZstdFrames: concatenated frames, each
 * with its own header, blocks, and optional 4-byte checksum).
 * @param {Buffer} buffer - complete file bytes.
 * @returns {{ frames: Array<{start:number,end:number}> }}
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('invalid zstd frame magic at byte ' + offset)
    }
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved zstd block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Decompress one session log file into event records. */
export function loadSessionFile(file) {
  const buf = fs.readFileSync(file)
  const { frames } = scanZstdFrames(buf)
  const plain = Buffer.concat(frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)))).toString('utf8')
  const events = []
  let header = null
  for (const line of plain.split('\n')) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev && ev.type === 'session') { header = ev; continue }
    events.push(ev)
  }
  return { events, header }
}

/** Scan a sessions root: [{ sessionId, workspaceDir, file, events, header }]. */
export function loadSessionsDir(dir, max = 500) {
  const out = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const ws of entries) {
    if (!ws.isDirectory()) continue
    const wsDir = path.join(dir, ws.name)
    let sessions
    try { sessions = fs.readdirSync(wsDir, { withFileTypes: true }) } catch { continue }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const file = path.join(wsDir, s.name, 'session.jsonl.zstd')
      if (!fs.existsSync(file)) continue
      try {
        const { events, header } = loadSessionFile(file)
        out.push({ sessionId: s.name, workspaceDir: ws.name, file, events, header })
      } catch { /* corrupt/partial session: skip */ }
      if (out.length >= max) return out
    }
  }
  return out
}

/**
 * Aggregate real session logs into presence task DTOs — same derivation the
 * live AgentPresenceService uses (heartbeat folding, resolveState, summaries).
 * @param {Array} sessions - output of loadSessionsDir().
 * @param {Object} [opts] - { now, staleMinutes, liveIds, systemAliveAt }
 * @returns {Array} sorted task DTOs (single source of truth).
 */
export function buildTasks(sessions, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now()
  const staleMs = normalizeStaleMs(opts.staleMinutes)
  const live = new Set(opts.liveIds || [])
  // Offline the engine cannot have answered, so the scan time stands in for
  // engine aliveness (an offline scan is itself proof the host machine runs);
  // callers that know the harness is down can pass an old opts.systemAliveAt
  // to reproduce the all-DISCONNECTED snapshot. Per-session DISCONNECTED via
  // the orphaned-open-turn rule is derived exactly as the live service does.
  const systemAliveAt = opts.systemAliveAt != null ? opts.systemAliveAt : now
  // per-session dedup maps (see service.js: identical tool calls in DIFFERENT
  // sessions are independent progress)
  const seenBySession = new Map()
  const tasks = []
  for (const s of sessions) {
    const events = s.events || []
    let seen = seenBySession.get(s.sessionId)
    if (!seen) { seen = new Map(); seenBySession.set(s.sessionId, seen) }
    const hb = foldHeartbeats(events, { now, seen })
    const loopLive = live.has(s.sessionId)
    // System heartbeat = engine liveness (effectiveSystemAliveAt), shared by
    // every reachable session. Only an orphaned open turn (open turn + not
    // live + log silent beyond the TTL) reports DISCONNECTED.
    const sysHeartbeatAt = effectiveSystemAliveAt({
      sessionHeartbeatAt: hb.systemHeartbeatAt,
      openTurn: hasOpenTurn(events),
      loopLive,
      systemAliveAt,
      now,
    })
    const pending = hasPendingApproval(events)
    const failed = terminalFailure(events)
    const done = completed(events)
    const running = agentRunning(events, loopLive)

    const staleReasons = []
    const state = resolveState({
      systemHeartbeatAt: sysHeartbeatAt,
      progressHeartbeatAt: hb.progressHeartbeatAt,
      pendingApproval: pending,
      terminalFailure: failed,
      completed: done,
      agentRunning: running,
      now,
      staleMs,
      observedErrorCount: hb.errorCount,
    }, staleReasons)

    const title = titleFromEvents(events)
    const summary = summarize(events, state)
    const startedAt = s.header && s.header.createdAt ? Number(s.header.createdAt) : (firstTime(events) || now)
    const updatedAt = hb.systemHeartbeatAt || lastTime(events) || startedAt

    tasks.push(makeTaskDTO({
      taskId: s.sessionId,
      sessionId: s.sessionId,
      workspaceId: s.workspaceDir || null,
      title,
      state,
      summary,
      systemHeartbeatAt: sysHeartbeatAt ? new Date(sysHeartbeatAt).toISOString() : null,
      progressHeartbeatAt: hb.progressHeartbeatAt ? new Date(hb.progressHeartbeatAt).toISOString() : null,
      startedAt,
      updatedAt,
      attention: state === STATE.NEEDS_USER ? { kind: 'approval', summary: 'Agent is waiting for you' } : null,
      staleReason: state === STATE.STALE ? staleReasonLines({
        progressMins: hb.progressHeartbeatAt ? Math.max(1, Math.floor((now - hb.progressHeartbeatAt) / 60000)) : 0,
        errorCount: hb.errorCount,
        repeatedError: hb.errorCount > 1,
        fileChanges: fileChangeCount(events),
        taskTransitions: 0,
      }) : null,
      // turnCycle: same derivation as the live service (user-role message count)
      turnCycle: userTurnCount(events),
    }))
  }
  tasks.sort((a, b) => {
    const pa = STATE_PRIORITY[a.state] ?? 99
    const pb = STATE_PRIORITY[b.state] ?? 99
    if (pa !== pb) return pa - pb
    return b.updatedAt - a.updatedAt
  })
  return tasks
}

function truncate(s, n) {
  const str = String(s == null ? '' : s)
  return str.length <= n ? str : str.slice(0, n - 1) + '…'
}

function renderTable(tasks) {
  const rows = tasks.map((t) => {
    const mins = t.progressHeartbeatAt
      ? Math.max(1, Math.floor((Date.now() - Date.parse(t.progressHeartbeatAt)) / 60000)) + 'm'
      : '—'
    const stalled = t.state === STATE.STALE && t.staleReason && t.staleReason.length > 0
      ? ' [' + truncate(t.staleReason[0], 36) + ']'
      : ''
    return {
      state: (STATE_LABEL[t.state] ? STATE_LABEL[t.state].icon : '?') + ' ' + (t.state || '?').padEnd(12),
      title: truncate(t.title, 26).padEnd(26),
      summary: truncate(t.summary, 34).padEnd(34),
      last: mins.padEnd(5),
      id: truncate(t.sessionId, 14),
      stalled,
    }
  })
  const head = 'state          title                       summary                              last  sessionId       '
  const lines = [head, '-'.repeat(head.length)]
  for (const r of rows) {
    lines.push(r.state + ' ' + r.title + ' ' + r.summary + ' ' + r.last + ' ' + r.id + r.stalled)
  }
  lines.push('')
  lines.push('tasks: ' + tasks.length + '   orb: ' + (highestPriorityTask(tasks)
    ? STATE_LABEL[highestPriorityTask(tasks).state].text
    : 'none'))
  return lines.join('\n')
}

export function main(argv) {
  const args = argv || process.argv.slice(2)
  let sessionsDir = path.join(os.homedir(), '.dsh', 'sessions')
  let staleMin
  let json = false
  let max = 500
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--sessions') sessionsDir = args[++i]
    else if (a === '--stale-min') staleMin = Number(args[++i])
    else if (a === '--json') json = true
    else if (a === '--max') max = Number(args[++i])
  }
  const sessions = loadSessionsDir(sessionsDir, max)
  const tasks = buildTasks(sessions, { staleMinutes: staleMin })
  if (json) {
    console.log(JSON.stringify({ tasks, orb: highestPriorityTask(tasks) }, null, 2))
  } else {
    console.log('sessions dir: ' + sessionsDir)
    console.log('stale threshold: ' + normalizeStaleMs(staleMin) / 60000 + 'm   scanned sessions: ' + sessions.length)
    console.log('')
    console.log(renderTable(tasks))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
