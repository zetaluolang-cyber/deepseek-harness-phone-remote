// Agent Presence (Phase A) unit tests: state machine, dual heartbeat,
// meaningful progress rules, STALE heuristic, priority, summary, recovery.
// Run: node --test test/presence.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  STATE, STATE_PRIORITY, STATE_LABEL, DEFAULT_STALE_MS,
  normalizeStaleMs, highestPriorityTask, makeTaskDTO,
} from '../lib/presence/contract.js'
import { classifyProgress, foldHeartbeats, isSystemAlive, isProgressStale } from '../lib/presence/heartbeat.js'
import { resolveState, transition } from '../lib/presence/state.js'
import { summarize, staleReasonLines } from '../lib/presence/summary.js'
import {
  createPresenceService, terminalFailure, hasToolErrorInLastTurn, hasOpenTurn,
} from '../lib/presence/service.js'

// Dynamic "now-ish" base time: the service aggregator reconciles against the
// REAL clock (Date.now()), so a fixed absolute t0 becomes a time bomb once
// the real time passes t0 + system TTL (events look dead -> DISCONNECTED).
// t0 is kept 5s in the past: fresh enough for RUNNING/DONE/FAILED assertions
// and stable across any real clock.
const t0 = Date.now() - 5000
const ev = (type, data, time = t0, seq = 0) => ({ seq, type, time, data })
const toolOk = (name = 'bash', args = '{}', time = t0) => ev('tool/result', { name, message: { role: 'tool', content: 'ok' }, arguments: args }, time)
const toolErr = (name = 'bash', time = t0) => ev('tool/result', { name, error: { name: 'E', code: '1' } }, time)
const turnStart = (turn = 1, time = t0) => ev('turn/start', { turn }, time)
const turnEnd = (reason, turn = 1, time = t0 + 1000) => ev('turn/end', { turn, reason: { kind: reason } }, time)

// ------------------------------------------------------------ state machine

test('presence state: fresh progress -> RUNNING', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 5000, progressHeartbeatAt: t0 + 5000,
    pendingApproval: false, terminalFailure: false, completed: false,
    agentRunning: true, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.RUNNING)
})

test('presence state: stale progress + live heartbeat -> STALE (explainable)', () => {
  const reasons = []
  const s = resolveState({
    systemHeartbeatAt: t0 + (21 * 60 * 1000), // system alive (fresh)
    progressHeartbeatAt: t0,                    // progress stale (21m ago)
    pendingApproval: false, terminalFailure: false, completed: false,
    agentRunning: true, now: t0 + (21 * 60 * 1000), staleMs: DEFAULT_STALE_MS,
    observedErrorCount: 0,
  }, reasons)
  assert.equal(s, STATE.STALE)
  assert.ok(reasons.some((r) => /no meaningful progress for 21m/.test(r)),
    'STALE must be explainable: ' + reasons.join(' | '))
})

test('presence state: lost heartbeat -> DISCONNECTED (distinct from STALE)', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 - 120000, progressHeartbeatAt: t0,
    pendingApproval: false, terminalFailure: false, completed: false,
    agentRunning: true, now: t0, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.DISCONNECTED)
})

test('presence state: pending approval -> NEEDS_USER (highest priority)', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 6000, progressHeartbeatAt: t0 + 6000,
    pendingApproval: true, terminalFailure: false, completed: false,
    agentRunning: true, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.NEEDS_USER)
})

test('presence state: terminal failure -> FAILED', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 6000, progressHeartbeatAt: t0 + 6000,
    pendingApproval: false, terminalFailure: true, completed: false,
    agentRunning: false, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.FAILED)
})

test('presence state: completion -> DONE', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 6000, progressHeartbeatAt: t0 + 6000,
    pendingApproval: false, terminalFailure: false, completed: true,
    agentRunning: false, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.DONE)
})

test('presence state: idle session -> IDLE', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 6000, progressHeartbeatAt: null,
    pendingApproval: false, terminalFailure: false, completed: false,
    agentRunning: false, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.IDLE)
})

test('presence priority: NEEDS_USER > FAILED > STALE > RUNNING > DONE > IDLE', () => {
  const order = [STATE.NEEDS_USER, STATE.FAILED, STATE.STALE, STATE.RUNNING, STATE.DONE, STATE.IDLE]
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(STATE_PRIORITY[order[i]] < STATE_PRIORITY[order[i + 1]],
      order[i] + ' must rank above ' + order[i + 1])
  }
  // highestPriorityTask picks the top of the list
  const tasks = [
    makeTaskDTO({ taskId: 'a', sessionId: 'a', state: STATE.RUNNING }),
    makeTaskDTO({ taskId: 'b', sessionId: 'b', state: STATE.NEEDS_USER }),
    makeTaskDTO({ taskId: 'c', sessionId: 'c', state: STATE.STALE }),
  ]
  assert.equal(highestPriorityTask(tasks).taskId, 'b')
})

// ------------------------------------------------------------ transitions

test('presence transition: STALE + new progress -> RUNNING (recovery)', () => {
  assert.equal(transition(STATE.STALE, STATE.RUNNING), STATE.RUNNING)
})

test('presence transition: DONE/FAILED do not regress to RUNNING on same task', () => {
  assert.equal(transition(STATE.DONE, STATE.RUNNING), STATE.DONE)
  assert.equal(transition(STATE.FAILED, STATE.RUNNING), STATE.FAILED)
})

// Dogfood finding: a still-open turn must never be FAILED just because a tool
// call inside it errored — the agent is working and may self-recover
// (design §4.2: FAILED = stopped and cannot self-recover).

test('presence failure: OPEN turn with a tool error is NOT FAILED (may recover)', () => {
  const events = [turnStart(1, t0), toolOk('bash', '{}', t0 + 100), toolErr('pwsh', t0 + 200)]
  assert.equal(hasOpenTurn(events), true)
  assert.equal(hasToolErrorInLastTurn(events), false, 'open turn excluded from failure scan')
  assert.equal(terminalFailure(events), false)
})

test('presence failure: CLOSED turn with a tool error -> FAILED', () => {
  const events = [turnStart(1, t0), toolErr('bash', t0 + 100), turnEnd('completed', 1, t0 + 200)]
  assert.equal(hasOpenTurn(events), false)
  assert.equal(hasToolErrorInLastTurn(events), true)
  assert.equal(terminalFailure(events), true)
})

test('presence failure: closed turn reason=error -> FAILED, new open turn recovers', () => {
  const failed = [turnStart(1, t0), toolOk('bash', '{}', t0 + 100), turnEnd('error', 1, t0 + 200)]
  assert.equal(terminalFailure(failed), true)
  const recovered = [...failed, turnStart(2, t0 + 300), toolOk('edit', '{"p":"x"}', t0 + 400)]
  assert.equal(terminalFailure(recovered), false, 'a new open turn means the agent works again')
  assert.equal(hasToolErrorInLastTurn(recovered), false, 'only the last CLOSED turn is scanned')
})

// ------------------------------------------------------------ heartbeats

test('presence heartbeat: meaningful progress updates progressHeartbeatAt', () => {
  const events = [
    turnStart(1, t0),
    toolOk('bash', '{"command":"ls"}', t0 + 1000),      // tool success = progress
    toolErr('bash', t0 + 2000),                          // new error = progress (error-change)
    ev('step/start', { turn: 1, step: 1 }, t0 + 3000),   // new plan step = progress
    turnEnd('completed', 1, t0 + 4000),                  // completion = progress
  ]
  const hb = foldHeartbeats(events, { now: t0 + 5000 })
  assert.equal(hb.progressHeartbeatAt, t0 + 4000)
  assert.equal(hb.systemHeartbeatAt, t0 + 4000)
})

test('presence heartbeat: repeated identical tool result does NOT advance progress', () => {
  const seen = new Map()
  const events = [
    toolOk('bash', '{"command":"ls"}', t0 + 1000),
    toolOk('bash', '{"command":"ls"}', t0 + 2000), // identical repeat
    toolOk('bash', '{"command":"ls"}', t0 + 3000), // identical repeat again
  ]
  const hb = foldHeartbeats(events, { now: t0 + 4000, seen })
  // first success advanced; repeats did not
  assert.equal(hb.progressHeartbeatAt, t0 + 1000)
})

test('presence heartbeat: repeated identical error does NOT advance progress', () => {
  const events = [
    toolErr('bash', t0 + 1000),
    toolErr('bash', t0 + 2000), // identical repeat
  ]
  const hb = foldHeartbeats(events, { now: t0 + 3000 })
  assert.equal(hb.progressHeartbeatAt, t0 + 1000, 'only the FIRST error-change advances')
  assert.equal(hb.errorCount, 2)
})

test('presence heartbeat: plain events (assistant chunk, same text) are NOT progress', () => {
  const events = [
    ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text', text: 'x' } }, t0 + 1000),
    ev('user/message', { content: 'hello' }, t0 + 2000),
  ]
  const hb = foldHeartbeats(events, { now: t0 + 3000 })
  assert.equal(hb.progressHeartbeatAt, null, 'chunks and plain messages are not progress')
  assert.equal(hb.systemHeartbeatAt, t0 + 2000, 'but they DO refresh the system heartbeat')
})

test('presence heartbeat: system alive checks TTL; stale checks threshold', () => {
  assert.equal(isSystemAlive(t0, t0 + 30000), true)
  assert.equal(isSystemAlive(t0, t0 + 120000), false)
  assert.equal(isProgressStale(t0, t0 + DEFAULT_STALE_MS + 1000), true)
  assert.equal(isProgressStale(t0, t0 + 1000), false)
  assert.equal(isProgressStale(null, t0), true)
})

// ------------------------------------------------------------ summary

test('presence summary: shows PROGRESS not ACTIVITY', () => {
  const events = [
    turnStart(1, t0),
    toolOk('bash', '{"command":"node --test"}', t0 + 1000),
    turnEnd('completed', 1, t0 + 2000),
  ]
  const s = summarize(events, STATE.DONE)
  assert.ok(s.includes('task complete'), 'summary: ' + s)
  assert.ok(!/Executed|command/.test(s), 'must not echo the command: ' + s)
})

test('presence stale reasons: explainable observable facts', () => {
  const lines = staleReasonLines({ progressMins: 34, errorCount: 6, repeatedError: true, fileChanges: 0, taskTransitions: 0 })
  assert.ok(lines.some((l) => /No meaningful progress for 34m/.test(l)))
  assert.ok(lines.some((l) => /same failure has repeated/.test(l)))
  assert.ok(lines.some((l) => /No file changes/.test(l)))
})

// ------------------------------------------------------------ aggregator

function fakeCtx({ records, eventsBySession, liveIds = [] }) {
  return {
    get(name) {
      switch (name) {
        case 'sessionQuery': return {
          listSessions: async () => records.slice(),
          listEvents: async (id) => (eventsBySession[id] || []).slice(),
          readTitle: async () => undefined,
        }
        case 'sessions': return { list: () => liveIds.map((id) => ({ id })) }
        case 'agents': return { list: () => liveIds.map((id) => ({ id, sessionId: id })) }
        case 'workspaceRegistry': return { list: () => [] }
        default: return undefined
      }
    },
  }
}

test('presence service: aggregates sessions into tasks with state + heartbeats', async () => {
  const ctx = fakeCtx({
    records: [
      { id: 's-running', header: { createdAt: t0 } },
      { id: 's-blocked', header: { createdAt: t0 } },
      { id: 's-failed', header: { createdAt: t0 } },
      { id: 's-done', header: { createdAt: t0 } },
    ],
    eventsBySession: {
      's-running': [turnStart(1, t0), toolOk('bash', '{"command":"a"}', t0 + 500), turnStart(2, t0 + 1000)],
      's-blocked': [turnStart(1, t0), ev('approval/asked', { id: 'a1', toolName: 'bash' }, t0 + 100), toolOk('bash', '{"command":"b"}', t0 + 200)],
      's-failed': [turnStart(1, t0), toolOk('bash', '{"command":"c"}', t0 + 100), turnEnd('error', 1, t0 + 200)],
      's-done': [turnStart(1, t0), toolOk('bash', '{"command":"d"}', t0 + 100), turnEnd('completed', 1, t0 + 200)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.ok, true)
  const byId = Object.fromEntries(res.value.tasks.map((t) => [t.sessionId, t]))
  assert.equal(byId['s-running'].state, STATE.RUNNING)
  assert.equal(byId['s-blocked'].state, STATE.NEEDS_USER)
  assert.equal(byId['s-blocked'].attention.kind, 'approval')
  assert.equal(byId['s-failed'].state, STATE.FAILED)
  assert.equal(byId['s-done'].state, STATE.DONE)
  // orb = highest priority task
  assert.equal(res.value.orb.sessionId, 's-blocked')
  // heartbeats present
  assert.ok(byId['s-running'].systemHeartbeatAt)
  assert.ok(byId['s-running'].progressHeartbeatAt)
})

test('presence service: STALE with no progress + live heartbeat, then recovery to RUNNING', async () => {
  const past = Date.now() - (21 * 60 * 1000)
  const now = Date.now()
  // system stays alive via plain events (chunks), progress is 21m old
  const ctx = fakeCtx({
    records: [{ id: 's1', header: { createdAt: past } }],
    eventsBySession: {
      's1': [
        turnStart(1, past), toolOk('bash', '{"command":"old"}', past + 500),
        ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text', text: 'x' } }, now - 1000),
      ],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  // first reconcile: progress is 21m old, system alive -> STALE
  let res = await svc.tasks()
  assert.equal(res.value.tasks[0].state, STATE.STALE)
  assert.ok(res.value.tasks[0].staleReason && res.value.tasks[0].staleReason.length > 0)
  // now new MEANINGFUL progress arrives
  const ctx2 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: past } }],
    eventsBySession: {
      's1': [
        turnStart(1, past), toolOk('bash', '{"command":"old"}', past + 500),
        ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text', text: 'x' } }, now - 1000),
        ev('turn/start', { turn: 2 }, now - 1000),
        toolOk('edit', '{"path":"new.txt"}', now - 500), // DIFFERENT tool+args = real new progress
      ],
    },
  })
  const svc2 = createPresenceService(ctx2, { staleMinutes: 20 })
  res = await svc2.tasks()
  assert.equal(res.value.tasks[0].state, STATE.RUNNING, 'fresh progress must recover STALE -> RUNNING')
})

// Dogfood finding: a tool error inside a still-open turn must not flip the
// session to FAILED while the agent is working.

test('presence service: open turn with tool error -> RUNNING (no false FAILED)', async () => {
  const ctx = fakeCtx({
    records: [{ id: 's1', header: { createdAt: t0 } }],
    eventsBySession: {
      's1': [turnStart(1, t0), toolOk('bash', '{}', t0 + 100), toolErr('pwsh', t0 + 200), turnStart(2, t0 + 300)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.value.tasks[0].state, STATE.RUNNING)
})

test('presence service: FAILED then a NEW turn opens -> RUNNING (new-task intent)', async () => {
  const ctx1 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: t0 } }],
    eventsBySession: {
      's1': [turnStart(1, t0), toolOk('bash', '{}', t0 + 100), turnEnd('error', 1, t0 + 200)],
    },
  })
  const svc1 = createPresenceService(ctx1, { staleMinutes: 20 })
  let res = await svc1.tasks()
  assert.equal(res.value.tasks[0].state, STATE.FAILED)
  // user sends a new message -> new turn opens with fresh meaningful progress
  const ctx2 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: t0 } }],
    eventsBySession: {
      's1': [
        turnStart(1, t0), toolOk('bash', '{}', t0 + 100), turnEnd('error', 1, t0 + 200),
        turnStart(2, t0 + 300), toolOk('edit', '{"p":"new.txt"}', t0 + 400),
      ],
    },
  })
  const svc2 = createPresenceService(ctx2, { staleMinutes: 20 })
  res = await svc2.tasks()
  assert.equal(res.value.tasks[0].state, STATE.RUNNING, 'a fresh open turn must leave FAILED')
})

// ------------------------------------------------------------ contract

test('presence contract: DTO defaults and stale threshold normalization', () => {
  const dto = makeTaskDTO({ taskId: 't', sessionId: 's', state: STATE.STALE })
  assert.equal(dto.title, 'Untitled')
  assert.equal(dto.state, STATE.STALE)
  assert.equal(dto.systemHeartbeatAt, null)
  assert.equal(dto.attention, null)
  assert.equal(normalizeStaleMs(10), 10 * 60 * 1000)
  assert.equal(normalizeStaleMs(30), 30 * 60 * 1000)
  assert.equal(normalizeStaleMs(7), DEFAULT_STALE_MS, 'unsupported threshold fails closed to default')
  assert.equal(normalizeStaleMs('abc'), DEFAULT_STALE_MS)
  // state labels have icon+text (never color-only)
  for (const s of Object.values(STATE)) {
    assert.ok(STATE_LABEL[s] && STATE_LABEL[s].icon && STATE_LABEL[s].text, 'label for ' + s)
  }
})

// ------------------------------------------------------------ service fail-closed

test('presence service: sessionQuery unavailable -> fails closed with error', async () => {
  const svc = createPresenceService({ get: () => undefined })
  const res = await svc.tasks()
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'capability-unavailable')
})
