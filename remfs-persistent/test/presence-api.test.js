// Presence API v1 FREEZE tests (Phase D). The contract is frozen: version,
// operation names, error-code vocabulary, 7-state model, DTO shape. Any
// change to the frozen surface (without a v2) fails here.
// Run: node --test test/presence-api.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATE, STATE_PRIORITY, PRESENCE_OPS, makeTaskDTO } from '../lib/presence/contract.js'
import {
  API_VERSION, API_ENGINE, API_OPS, ERROR_CODES, API_STATES,
  validateTaskDTO, validateTasksValue, validateStatusValue, isTaskDTO,
} from '../lib/presence/api.js'
import { createPresenceService } from '../lib/presence/service.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ------------------------------------------------------------ frozen identity

test('presence api v1: version and engine are frozen', () => {
  assert.equal(API_VERSION, 'v1')
  assert.equal(API_ENGINE, 'presence-v1')
  assert.deepEqual(API_OPS, {
    STATUS: 'presence.status',
    TASKS: 'presence.tasks',
    PUSH_SUBSCRIBE: 'push.subscribe',
    PUSH_UNSUBSCRIBE: 'push.unsubscribe',
  })
  assert.deepEqual(Object.keys(API_OPS).sort(), Object.keys(PRESENCE_OPS).sort(),
    'api.js operations must mirror contract PRESENCE_OPS')
  for (const k of Object.keys(API_OPS)) {
    assert.equal(API_OPS[k], PRESENCE_OPS[k], 'operation name ' + k + ' must match PRESENCE_OPS')
  }
})

test('presence api v1: the 7-state model and priority order are frozen', () => {
  assert.deepEqual(API_STATES, Object.keys(STATE).sort())
  // design §43 order (lower number = higher priority)
  const order = [
    STATE.NEEDS_USER, STATE.FAILED, STATE.STALE, STATE.RUNNING, STATE.DONE,
    STATE.IDLE, STATE.DISCONNECTED,
  ]
  assert.equal(API_STATES.length, 7)
  for (const s of order) assert.ok(s in STATE_PRIORITY, 'priority missing for ' + s)
  const sorted = order.slice().sort((a, b) => STATE_PRIORITY[a] - STATE_PRIORITY[b])
  assert.deepEqual(sorted, order, 'priority ranks: NEEDS_USER > FAILED > STALE > RUNNING > DONE > IDLE > DISCONNECTED')
})

test('presence api v1: every error code the implementation can emit is in ERROR_CODES', () => {
  const codes = new Set(Object.values(ERROR_CODES))
  // scan the implementation for hard-coded error codes (service + host pocket layer)
  const files = ['../lib/presence/service.js', '../lib/host.js']
  const used = new Set()
  for (const f of files) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8')
    for (const m of src.matchAll(/['"]([a-z][a-z0-9-]*)['"]\s*(?:,|\))/g)) {
      const code = m[1]
      if (/(^|-)(invalid|corrupt|denied|request|unavailable)$/.test(code)) used.add(code)
    }
  }
  for (const c of used) {
    assert.ok(codes.has(c), 'implementation uses error code "' + c + '" but ERROR_CODES does not define it')
  }
  // capability-denied is a frozen legacy code: the cockpit capability gate
  // was removed with the cockpit feature; the code stays in the v1
  // vocabulary (never emitted) so existing consumers keep parsing.
  const frozenLegacy = new Set(['capability-denied'])
  for (const c of codes) {
    assert.ok(used.has(c) || frozenLegacy.has(c),
      'ERROR_CODES lists "' + c + '" but no implementation site uses it')
  }
})

// ------------------------------------------------------------ DTO validation

test('presence api v1: a real task DTO passes validation', () => {
  const dto = makeTaskDTO({
    taskId: 't', sessionId: 's', workspaceId: 'w', title: 'Fix', state: STATE.RUNNING,
    summary: 'working', systemHeartbeatAt: new Date().toISOString(),
    progressHeartbeatAt: new Date().toISOString(), startedAt: 1, updatedAt: 2,
    attention: null, staleReason: null, sizeBytes: 12345678,
  })
  assert.equal(isTaskDTO(dto), true)
  assert.deepEqual(validateTaskDTO(dto), [])
  assert.equal(dto.sizeBytes, 12345678)
})

test('presence api v1: DTO validation fails closed on bad shapes', () => {
  assert.ok(validateTaskDTO(null).length > 0)
  assert.ok(validateTaskDTO({}).length > 0, 'missing all fields must fail')
  const bad = makeTaskDTO({ taskId: 't', sessionId: 's' })
  bad.state = 'BOGUS'
  assert.ok(validateTaskDTO(bad).some((p) => /state/.test(p)), 'unknown state must fail')
  const num = makeTaskDTO({ taskId: 't', sessionId: 's' })
  num.updatedAt = 'nope'
  assert.ok(validateTaskDTO(num).some((p) => /updatedAt/.test(p)))
  const sz = makeTaskDTO({ taskId: 't', sessionId: 's' })
  sz.sizeBytes = -5
  assert.ok(validateTaskDTO(sz).some((p) => /sizeBytes/.test(p)), 'negative sizeBytes must fail')
  assert.equal(makeTaskDTO({ taskId: 't', sessionId: 's' }).sizeBytes, 0, 'sizeBytes defaults to 0 (host cannot measure)')
})

test('presence api v1: STALE DTO carries explainable staleReason', () => {
  const dto = makeTaskDTO({
    taskId: 't', sessionId: 's', state: STATE.STALE,
    staleReason: ['no meaningful progress for 21m', 'the same failure has repeated'],
  })
  assert.deepEqual(validateTaskDTO(dto), [])
  assert.ok(dto.staleReason.length >= 2, 'STALE must be explainable (design §42)')
})

test('presence api v1: tasks/status value validators enforce the frozen shapes', () => {
  const now = Date.now()
  const task = makeTaskDTO({
    taskId: 't', sessionId: 's', state: STATE.RUNNING, title: 'x', summary: 'y',
    systemHeartbeatAt: new Date(now).toISOString(), progressHeartbeatAt: new Date(now).toISOString(),
    startedAt: now, updatedAt: now,
  })
  assert.deepEqual(validateTasksValue({ tasks: [task], orb: task }), [])
  assert.deepEqual(validateTasksValue({ tasks: [], orb: null }), [])
  assert.ok(validateTasksValue({ tasks: 'nope' }).length > 0)
  assert.ok(validateTasksValue({ tasks: [null] }).length > 0)
  assert.ok(validateTasksValue({}).length > 0, 'missing tasks array must fail')

  const status = {
    engine: API_ENGINE, apiVersion: API_VERSION, staleMinutes: 20,
    serverTime: new Date().toISOString(), capabilities: ['cockpit'],
  }
  assert.deepEqual(validateStatusValue(status), [])
  assert.ok(validateStatusValue({ ...status, apiVersion: 'v2' }).some((p) => /apiVersion/.test(p)),
    'a bumped apiVersion must fail v1 validation')
  assert.ok(validateStatusValue({ ...status, engine: 'presence-v2' }).some((p) => /engine/.test(p)))
})

// ------------------------------------------------------------ live service

function fakeCtx(records, eventsBySession) {
  return {
    get(name) {
      switch (name) {
        case 'sessionQuery': return {
          listSessions: async () => records.slice(),
          listEvents: async (id) => (eventsBySession[id] || []).slice(),
          readTitle: async () => undefined,
        }
        case 'sessions': return { list: () => [] }
        case 'agents': return { list: () => [] }
        case 'workspaceRegistry': return { list: () => [] }
        default: return undefined
      }
    },
  }
}

test('presence api v1: live service status/tasks responses satisfy the frozen schema', async () => {
  const t0 = Date.now()
  const svc = createPresenceService(fakeCtx(
    [{ id: 's1', header: { createdAt: t0 } }],
    {
      's1': [
        { seq: 1, type: 'turn/start', time: t0, data: { turn: 1 } },
        { seq: 2, type: 'tool/result', time: t0 + 100, data: { name: 'bash', message: { content: 'ok' } } },
        { seq: 3, type: 'turn/end', time: t0 + 200, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    },
  ), { staleMinutes: 20 })

  const st = await svc.status({ id: 'd1', capabilities: ['cockpit'] })
  assert.equal(st.ok, true)
  assert.deepEqual(validateStatusValue(st.value), [])
  assert.equal(st.value.engine, 'presence-v1')
  assert.equal(st.value.apiVersion, 'v1')

  const tasks = await svc.tasks()
  assert.equal(tasks.ok, true)
  assert.deepEqual(validateTasksValue(tasks.value), [], 'every live DTO must satisfy the frozen shape')
  assert.equal(tasks.value.tasks[0].state, STATE.DONE)
  if (tasks.value.orb) assert.deepEqual(validateTaskDTO(tasks.value.orb), [])
})

test('presence api v1: fail-closed errors carry frozen codes', async () => {
  const svc = createPresenceService({ get: () => undefined })
  const res = await svc.tasks()
  assert.equal(res.ok, false)
  assert.ok(Object.values(ERROR_CODES).includes(res.error.code),
    'error code must be in the frozen vocabulary: ' + res.error.code)
})

// The 942db92 regression class: listSessions() answers, but the record shape
// has drifted (no id/sessionId/header.id on ANY record). That must be an
// ERROR, never an innocent empty snapshot - an empty snapshot renders as
// "Idle", and a silent Idle is how the drift went unnoticed the first time.
test('presence tasks: whole-list SessionRecord shape drift is an error, not an empty snapshot', async () => {
  const svc = createPresenceService(fakeCtx(
    [{ uuid: 'x1', meta: {} }, { uuid: 'x2', meta: {} }], // unrecognizable shape
    {},
  ), { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'sessions-unavailable')
  assert.match(res.error.message, /shape/)
  assert.ok(Object.values(ERROR_CODES).includes(res.error.code), 'still inside the frozen vocabulary')
})

// ...but a PARTIAL drop (one malformed record among good ones) must not take
// presence down: the good records still aggregate.
test('presence tasks: a single malformed record is dropped, the rest aggregate', async () => {
  const t0 = Date.now()
  const svc = createPresenceService(fakeCtx(
    [{ uuid: 'bad' }, { id: 's1', header: { createdAt: t0 } }],
    { 's1': [{ seq: 1, type: 'turn/start', time: t0, data: { turn: 1 } }] },
  ), { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.ok, true)
  assert.equal(res.value.tasks.length, 1)
  assert.equal(res.value.tasks[0].sessionId, 's1')
})

// A genuinely empty session list stays a normal empty snapshot (fresh
// install), never a shape-drift error.
test('presence tasks: zero sessions is an empty snapshot, not an error', async () => {
  const svc = createPresenceService(fakeCtx([], {}), { staleMinutes: 20 })
  const res = await svc.tasks()
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.tasks, [])
})
