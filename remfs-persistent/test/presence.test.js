// Agent Presence (Phase A) unit tests: state machine, dual heartbeat,
// meaningful progress rules, STALE heuristic, priority, summary, recovery.
//
// SYSTEM HEARTBEAT SEMANTICS (P0 fix): the system heartbeat is ENGINE
// liveness ("the harness process is alive and answering"), not "the session
// logged an event recently". Presence answering a query IS liveness, so quiet
// sessions (agent waiting, NEEDS_USER, DONE, FAILED, IDLE, even empty logs)
// keep their state and NEVER decay to DISCONNECTED ~60s after their last
// event. DISCONNECTED is reserved for a stale/absent ENGINE heartbeat or an
// orphaned per-session loop (open turn + not live + log silent past the TTL).
// Pure tests below use a fixed t0 with an explicit `now`; service tests use
// real-clock offsets (no "now-5s dodge" anywhere).
// Run: node --test test/presence.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STATE, STATE_PRIORITY, STATE_LABEL, DEFAULT_STALE_MS,
  normalizeStaleMs, highestPriorityTask, makeTaskDTO,
} from '../lib/presence/contract.js'
import {
  classifyProgress, foldHeartbeats, effectiveSystemAliveAt,
  isSystemAlive, isProgressStale,
} from '../lib/presence/heartbeat.js'
import { resolveState, transition } from '../lib/presence/state.js'
import { summarize, staleReasonLines } from '../lib/presence/summary.js'
import {
  createPresenceService, terminalFailure, hasToolErrorInLastTurn, hasOpenTurn,
} from '../lib/presence/service.js'

// Fixed synthetic base time for PURE state/heartbeat tests: every one of
// those calls resolveState()/foldHeartbeats()/isSystemAlive() with an
// explicit `now`, so t0 never touches the wall clock and there is no "keep
// events inside the 60s system TTL" dodge to maintain.
const t0 = 1755388800000
const ev = (type, data, time = t0, seq = 0) => ({ seq, type, time, data })
const toolOk = (name = 'bash', args = '{}', time = t0) => ev('tool/result', { name, message: { role: 'tool', content: 'ok' }, arguments: args }, time)
const toolErr = (name = 'bash', time = t0) => ev('tool/result', { name, error: { name: 'E', code: '1' } }, time)
const turnStart = (turn = 1, time = t0) => ev('turn/start', { turn }, time)
const turnEnd = (reason, turn = 1, time = t0 + 1000) => ev('turn/end', { turn, reason: { kind: reason } }, time)

// Real-clock helpers for SERVICE aggregator tests: the service resolves
// against the real clock (its engine-aliveness timestamp is Date.now()), so
// event times are expressed relative to Date.now(). Quiet sessions may sit far
// outside the 60s system TTL on purpose - the system heartbeat is engine
// liveness, so event age must never decide DISCONNECTED.
const MIN = 60 * 1000
const minsAgo = (mins, extraMs = 0) => Date.now() - mins * MIN + extraMs

// ------------------------------------------------------------ state machine

test('presence state: fresh progress -> RUNNING', () => {
  const s = resolveState({
    systemHeartbeatAt: t0 + 5000, progressHeartbeatAt: t0 + 5000,
    pendingApproval: false, terminalFailure: false, completed: false,
    agentRunning: true, now: t0 + 6000, staleMs: DEFAULT_STALE_MS,
  })
  assert.equal(s, STATE.RUNNING)
})

test('presence state: stale progress + fresh system heartbeat -> STALE (explainable)', () => {
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

test('presence state: stale SYSTEM heartbeat (harness not answering) -> DISCONNECTED (distinct from STALE)', () => {
  const s = resolveState({
    // The system heartbeat is engine liveness: it is 2m old -> the harness is
    // NOT answering -> cannot confirm anything, so even a pending/progressing
    // agent resolves DISCONNECTED. STALE requires the system to be ALIVE.
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

test('presence state: no events + fresh system heartbeat -> IDLE, never DISCONNECTED', () => {
  // An empty/quiet session with a FRESH system heartbeat (the engine just
  // answered) has no running agent and no progress: it is IDLE. The OLD bug
  // equated "no recent event" with "dead" and reported DISCONNECTED here.
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

// The guard implements exactly ONE clamp (the DONE/FAILED -> RUNNING case
// above). Everything else is pass-through by design: without task identity we
// cannot tell an illegal jump from a legitimate new task. Pinned so a future
// "stricter" matrix has to change this test deliberately.
test('presence transition: no prior state passes through', () => {
  assert.equal(transition(null, STATE.RUNNING), STATE.RUNNING)
  assert.equal(transition(undefined, STATE.DONE), STATE.DONE)
  assert.equal(transition('', STATE.NEEDS_USER), STATE.NEEDS_USER)
})

test('presence transition: every non-clamped edge is pass-through', () => {
  // terminal states may still move to any NON-RUNNING state
  assert.equal(transition(STATE.DONE, STATE.NEEDS_USER), STATE.NEEDS_USER)
  assert.equal(transition(STATE.DONE, STATE.IDLE), STATE.IDLE)
  assert.equal(transition(STATE.FAILED, STATE.DISCONNECTED), STATE.DISCONNECTED)
  // ordinary forward edges
  assert.equal(transition(STATE.RUNNING, STATE.STALE), STATE.STALE)
  assert.equal(transition(STATE.RUNNING, STATE.NEEDS_USER), STATE.NEEDS_USER)
  assert.equal(transition(STATE.NEEDS_USER, STATE.RUNNING), STATE.RUNNING)
  // identity
  assert.equal(transition(STATE.DONE, STATE.DONE), STATE.DONE)
  assert.equal(transition(STATE.RUNNING, STATE.RUNNING), STATE.RUNNING)
})

// Dogfood finding: a still-open turn must never be FAILED just because a tool
// call inside it errored - the agent is working and may self-recover
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
  // log-activity observation = latest event time (a floor, not the aliveness
  // decision - see effectiveSystemAliveAt)
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
  assert.equal(hb.systemHeartbeatAt, t0 + 2000, 'log-activity observation = latest event')
})

test('presence heartbeat: system alive checks TTL; stale checks threshold', () => {
  assert.equal(isSystemAlive(t0, t0 + 30000), true)
  assert.equal(isSystemAlive(t0, t0 + 120000), false)
  assert.equal(isProgressStale(t0, t0 + DEFAULT_STALE_MS + 1000), true)
  assert.equal(isProgressStale(t0, t0 + 1000), false)
  assert.equal(isProgressStale(null, t0), true)
})

test('presence heartbeat: effectiveSystemAliveAt - reachable sessions inherit ENGINE liveness', () => {
  const now = t0 + 5000
  // a session whose log is silent for an hour is still alive: the ENGINE
  // answered this snapshot, and its heartbeat is the engine time
  const quietClosed = effectiveSystemAliveAt({
    sessionHeartbeatAt: t0 - 3600000, openTurn: false, loopLive: false,
    systemAliveAt: now, now,
  })
  assert.equal(quietClosed, now)
  // an empty log (no events at all) is equally reachable
  const empty = effectiveSystemAliveAt({
    sessionHeartbeatAt: null, openTurn: false, loopLive: false,
    systemAliveAt: now, now,
  })
  assert.equal(empty, now)
  // a LIVE but silent agent (open turn, live, no log activity for hours) is
  // still alive: it may simply be quiet (STALE-prone, never DISCONNECTED)
  const liveQuiet = effectiveSystemAliveAt({
    sessionHeartbeatAt: t0 - 3600000, openTurn: true, loopLive: true,
    systemAliveAt: now, now,
  })
  assert.equal(liveQuiet, now)
})

test('presence heartbeat: effectiveSystemAliveAt - orphaned loop and stale engine are DISCONNECTED-prone', () => {
  const now = t0 + 5000
  // orphaned open turn: the log shows a turn that never closed, the session
  // is NOT live, and the log is silent past the TTL (crash/restart mid-turn)
  const orphan = effectiveSystemAliveAt({
    sessionHeartbeatAt: t0 - 120000, openTurn: true, loopLive: false,
    systemAliveAt: now, now,
  })
  assert.equal(orphan, t0 - 120000, 'orphan returns its stale log heartbeat -> DISCONNECTED')
  // a recently-active open turn WITHOUT live membership is not yet an orphan
  const freshTurn = effectiveSystemAliveAt({
    sessionHeartbeatAt: now - 1000, openTurn: true, loopLive: false,
    systemAliveAt: now, now,
  })
  assert.equal(freshTurn, now)
  // a stale/absent engine heartbeat means nothing can be confirmed alive
  const staleEngine = effectiveSystemAliveAt({
    sessionHeartbeatAt: t0 - 1000, openTurn: false, loopLive: false,
    systemAliveAt: t0 - 120000, now,
  })
  assert.equal(staleEngine, t0 - 120000)
  assert.equal(effectiveSystemAliveAt({
    sessionHeartbeatAt: now - 1000, openTurn: false, loopLive: false,
    systemAliveAt: null, now,
  }), null, 'never-alive engine -> null heartbeat -> DISCONNECTED (fail closed)')
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
  const at = minsAgo(2) // fresh enough for RUNNING/NEEDS_USER meaningful progress
  const ctx = fakeCtx({
    records: [
      { id: 's-running', header: { createdAt: minsAgo(10) } },
      { id: 's-blocked', header: { createdAt: minsAgo(10) } },
      { id: 's-failed', header: { createdAt: minsAgo(10) } },
      { id: 's-done', header: { createdAt: minsAgo(10) } },
    ],
    // live agent loops: the RUNNING agent works, the blocked one waits on you
    liveIds: ['s-running', 's-blocked'],
    eventsBySession: {
      's-running': [turnStart(1, at), toolOk('bash', '{"command":"a"}', at + 500), turnStart(2, at + 1000)],
      's-blocked': [turnStart(1, at), ev('approval/asked', { id: 'a1', toolName: 'bash' }, at + 100), toolOk('bash', '{"command":"b"}', at + 200)],
      's-failed': [turnStart(1, at), toolOk('bash', '{"command":"c"}', at + 100), turnEnd('error', 1, at + 200)],
      's-done': [turnStart(1, at), toolOk('bash', '{"command":"d"}', at + 100), turnEnd('completed', 1, at + 200)],
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
  // heartbeats present; systemHeartbeatAt = engine liveness (fresh ISO)
  assert.ok(byId['s-running'].systemHeartbeatAt)
  assert.ok(Date.now() - Date.parse(byId['s-running'].systemHeartbeatAt) < MIN,
    'system heartbeat must be the answering engine, i.e. now')
  assert.ok(byId['s-running'].progressHeartbeatAt)
})

test('presence service: real DSH SessionRecord shape ({ header: { id } }) is aggregated', async () => {
  // dogfood finding: the live sessionQuery returns records shaped
  // { header: { id, createdAt, ... }, live, persisted } - reading only
  // record.id produced NO tasks and an always-empty Orb.
  const tLive = minsAgo(2)
  const ctx = fakeCtx({
    records: [
      { header: { id: 's-live', createdAt: minsAgo(5) }, live: true, persisted: false },
      { header: { id: 's-persisted', createdAt: minsAgo(130) }, live: false, persisted: true },
    ],
    liveIds: ['s-live'],
    eventsBySession: {
      's-live': [turnStart(1, tLive), toolOk('bash', '{"command":"live"}', tLive + 100)],
      's-persisted': [turnStart(1, minsAgo(130)), turnEnd('completed', 1, minsAgo(130) + 200)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.ok, true)
  assert.equal(res.value.tasks.length, 2, 'both DSH-shaped records must aggregate')
  const byId = Object.fromEntries(res.value.tasks.map((t) => [t.sessionId, t]))
  assert.equal(byId['s-live'].state, STATE.RUNNING)
  // a persisted DONE session last touched 2h ago is DONE, not DISCONNECTED:
  // quiet does not decay while the engine answers
  assert.equal(byId['s-persisted'].state, STATE.DONE)
  assert.ok(res.value.orb, 'orb must pick the highest-priority task')
})

test('presence service: STALE with stale progress + live agent, then recovery to RUNNING', async () => {
  const past = minsAgo(21)
  const ctx = fakeCtx({
    records: [{ id: 's1', header: { createdAt: past } }],
    // the agent CLAIMS running (its loop is live) but produced no meaningful
    // progress for 21m. No chunks are needed to "keep the system heartbeat
    // alive": the heartbeat is engine liveness, and answering this query IS
    // liveness (the old chunk hack existed for the removed event-TTL model).
    liveIds: ['s1'],
    eventsBySession: {
      's1': [turnStart(1, past), toolOk('bash', '{"command":"old"}', past + 500)],
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
    liveIds: ['s1'],
    eventsBySession: {
      's1': [
        turnStart(1, past), toolOk('bash', '{"command":"old"}', past + 500),
        toolOk('edit', '{"path":"new.txt"}', minsAgo(0, -500)), // different tool+args = real new progress
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
  const at = minsAgo(2)
  const ctx = fakeCtx({
    records: [{ id: 's1', header: { createdAt: minsAgo(10) } }],
    liveIds: ['s1'],
    eventsBySession: {
      's1': [turnStart(1, at), toolOk('bash', '{}', at + 100), toolErr('pwsh', at + 200), turnStart(2, at + 300)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.value.tasks[0].state, STATE.RUNNING)
})

test('presence service: FAILED then a NEW turn opens -> RUNNING (new-task intent)', async () => {
  const failedAt = minsAgo(130) // FAILED persists even hours later while the system is alive
  const ctx1 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: minsAgo(131) } }],
    eventsBySession: {
      's1': [turnStart(1, failedAt), toolOk('bash', '{}', failedAt + 100), turnEnd('error', 1, failedAt + 200)],
    },
  })
  const svc1 = createPresenceService(ctx1, { staleMinutes: 20 })
  let res = await svc1.tasks()
  assert.equal(res.value.tasks[0].state, STATE.FAILED)
  // user sends a new message -> a new turn opens with fresh progress
  const turn2 = minsAgo(2)
  const ctx2 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: minsAgo(131) } }],
    liveIds: ['s1'],
    eventsBySession: {
      's1': [
        turnStart(1, failedAt), toolOk('bash', '{}', failedAt + 100), turnEnd('error', 1, failedAt + 200),
        turnStart(2, turn2), toolOk('edit', '{"p":"new.txt"}', turn2 + 1000),
      ],
    },
  })
  const svc2 = createPresenceService(ctx2, { staleMinutes: 20 })
  res = await svc2.tasks()
  assert.equal(res.value.tasks[0].state, STATE.RUNNING, 'a fresh open turn must leave FAILED')
})

test('presence service: identical tool calls in DIFFERENT sessions are independent progress', async () => {
  // dogfood finding: the dedup seen-map was shared across sessions, so the
  // second session running the SAME tool call was suppressed -> STALE.
  const at = minsAgo(2)
  const ctx = fakeCtx({
    records: [
      { id: 's1', header: { createdAt: minsAgo(5) } },
      { id: 's2', header: { createdAt: minsAgo(5) } },
    ],
    liveIds: ['s1', 's2'],
    eventsBySession: {
      // byte-identical tool call (same name + args) in BOTH sessions
      's1': [turnStart(1, at), toolOk('bash', '{"command":"x"}', at + 100)],
      's2': [turnStart(1, at), toolOk('bash', '{"command":"x"}', at + 100)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  const byId = Object.fromEntries(res.value.tasks.map((t) => [t.sessionId, t]))
  assert.equal(byId['s1'].state, STATE.RUNNING)
  assert.equal(byId['s2'].state, STATE.RUNNING, 's2 progress must not be suppressed by s1')
  // and a repeat WITHIN the same session is still suppressed
  const ctx2 = fakeCtx({
    records: [{ id: 's1', header: { createdAt: minsAgo(5) } }],
    liveIds: ['s1'],
    eventsBySession: {
      's1': [turnStart(1, at), toolOk('bash', '{"command":"x"}', at + 100), toolOk('bash', '{"command":"x"}', at + 200)],
    },
  })
  const svc2 = createPresenceService(ctx2, { staleMinutes: 20 })
  const res2 = await svc2.tasks()
  assert.equal(res2.value.tasks[0].state, STATE.RUNNING)
})

// ------------------------------------------------------------ REAL semantics (P0 fix)
// The system heartbeat is engine liveness, so a quiet session - no matter how
// long since its last event - keeps its own state while the engine answers.

test('presence service: a quiet NEEDS_USER session stays NEEDS_USER while the system is alive', async () => {
  // The agent asked for approval two hours ago and is still waiting. Its log
  // is silent far beyond the 60s system TTL: under the OLD semantics (system
  // heartbeat = last event time) this decayed to DISCONNECTED. Answering this
  // query proves the harness is alive, so NEEDS_USER persists.
  const quiet = minsAgo(120)
  const ctx = fakeCtx({
    records: [{ id: 's-wait', header: { createdAt: minsAgo(121) } }],
    liveIds: ['s-wait'], // a waiting agent is still a live agent loop
    eventsBySession: {
      's-wait': [
        turnStart(1, quiet),
        ev('approval/asked', { id: 'q1', toolName: 'bash' }, quiet + 100),
      ],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  const t = res.value.tasks[0]
  assert.equal(t.state, STATE.NEEDS_USER, 'quiet NEEDS_USER must not decay to DISCONNECTED')
  assert.equal(t.attention.kind, 'approval')
  assert.ok(t.systemHeartbeatAt, 'a served session carries a system heartbeat')
  assert.ok(Date.now() - Date.parse(t.systemHeartbeatAt) < MIN,
    'system heartbeat = engine liveness (now), not the 2h-old last event')
})

test('presence service: DONE and FAILED persist while quiet (no decay to DISCONNECTED)', async () => {
  // Closed turns two hours ago: DONE/FAILED are terminal observations that do
  // not decay just because the agent went quiet afterwards.
  const closed = minsAgo(120)
  const ctx = fakeCtx({
    records: [
      { id: 's-done', header: { createdAt: minsAgo(121) } },
      { id: 's-failed', header: { createdAt: minsAgo(121) } },
    ],
    eventsBySession: {
      's-done': [turnStart(1, closed), toolOk('bash', '{"command":"x"}', closed + 100), turnEnd('completed', 1, closed + 200)],
      's-failed': [turnStart(1, closed), toolOk('bash', '{"command":"y"}', closed + 100), turnEnd('error', 1, closed + 200)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  const byId = Object.fromEntries(res.value.tasks.map((x) => [x.sessionId, x]))
  assert.equal(byId['s-done'].state, STATE.DONE)
  assert.equal(byId['s-failed'].state, STATE.FAILED)
  assert.ok(byId['s-done'].systemHeartbeatAt, 'quiet DONE still carries the engine heartbeat')
})

test('presence service: an empty session and an old quiet session read IDLE while the system is alive', async () => {
  // A session record with NO events ever (fresh create, nothing logged yet)
  // used to read DISCONNECTED forever (system heartbeat was null). While the
  // engine answers it is IDLE. Same for an old session whose only activity
  // was plain (no turns): quiet, not dead.
  const ctx = fakeCtx({
    records: [
      { id: 's-empty', header: { createdAt: Date.now() - 1000 } },
      { id: 's-old-idle', header: { createdAt: minsAgo(121) } },
    ],
    eventsBySession: {
      's-empty': [],
      's-old-idle': [
        ev('sandbox/mode', { mode: 'safe' }, minsAgo(120)),
        ev('session/title', { title: 'Old quiet note' }, minsAgo(120)),
      ],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  const byId = Object.fromEntries(res.value.tasks.map((x) => [x.sessionId, x]))
  assert.equal(byId['s-empty'].state, STATE.IDLE, 'empty session is IDLE, not DISCONNECTED')
  assert.equal(byId['s-old-idle'].state, STATE.IDLE, 'old quiet session is IDLE, not DISCONNECTED')
  assert.ok(byId['s-empty'].systemHeartbeatAt, 'IDLE empty session still carries the engine heartbeat')
})

test('presence service: DISCONNECTED only when the per-session loop is gone (orphaned open turn)', async () => {
  // While the engine answers, one session with an ORPHANED open turn (open for
  // 10m, not live, log silent past the TTL - a crash/restart left the turn
  // unclosed) is DISCONNECTED, while a healthy LIVE session in the SAME
  // snapshot stays RUNNING: DISCONNECTED is per-session, not all-or-nothing.
  const ctx = fakeCtx({
    records: [
      { id: 's-orphan', header: { createdAt: minsAgo(60) } },
      { id: 's-healthy', header: { createdAt: minsAgo(5) } },
    ],
    liveIds: ['s-healthy'],
    eventsBySession: {
      's-orphan': [turnStart(1, minsAgo(10)), toolOk('bash', '{"command":"old"}', minsAgo(10) + 500)],
      's-healthy': [turnStart(1, minsAgo(2)), toolOk('bash', '{"command":"x"}', minsAgo(2) + 100)],
    },
  })
  const svc = createPresenceService(ctx, { staleMinutes: 20 })
  const res = await svc.tasks()
  const byId = Object.fromEntries(res.value.tasks.map((x) => [x.sessionId, x]))
  assert.equal(byId['s-orphan'].state, STATE.DISCONNECTED, 'orphaned open turn = loop gone')
  assert.equal(byId['s-healthy'].state, STATE.RUNNING, 'healthy live session unaffected')
  assert.ok(Date.parse(byId['s-orphan'].systemHeartbeatAt) < minsAgo(1),
    'DISCONNECTED DTO carries its stale heartbeat (the orphaned turn time)')
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
