// Authorization rules of the /pocket dispatcher (presence/pocket.js).
// These were untestable while the handler lived inline in host.js apply() —
// which is how push ops shipped with no capability gate at all (the PR #3
// "known debt"). Every rule is pinned here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPocketHandler } from '../lib/presence/pocket.js'
import { ERROR_CODES, validateTaskDTO } from '../lib/presence/api.js'
import { UNAUTH_TITLE, redactTaskDTO, redactTasksValue, redactTasksEnvelope } from '../lib/presence/redact.js'

const okEnv = (value) => ({ ok: true, value })

function makeHandler(over = {}) {
  const calls = { subscribe: 0, unsubscribe: 0, test: 0, status: 0 }
  const handler = createPocketHandler({
    presence: {
      status: (device) => okEnv({ who: device ? device.id : null }),
      tasks: () => okEnv({ tasks: [] }),
    },
    verifyDevice: over.verifyDevice || (async () => ({ ok: true, device: { id: 'd1', capabilities: ['files', 'device-admin'] } })),
    pocketStrict: over.pocketStrict || false,
    pushSubscribe: async () => { calls.subscribe++; return okEnv({ subscribed: true }) },
    pushUnsubscribe: async () => { calls.unsubscribe++; return okEnv({ removed: 1 }) },
    pushStatus: async () => { calls.status++; return okEnv({ subscriptions: [] }) },
    pushTest: async () => { calls.test++; return okEnv({ sent: 1, results: [] }) },
    ...over.deps,
  })
  return { handler, calls }
}

test('pocket: files-capable device may subscribe and unsubscribe', async () => {
  const { handler, calls } = makeHandler()
  assert.equal((await handler('push.subscribe', { deviceId: 'd1', credential: 'c' })).ok, true)
  assert.equal((await handler('push.unsubscribe', { deviceId: 'd1', credential: 'c' })).ok, true)
  assert.equal(calls.subscribe, 1)
  assert.equal(calls.unsubscribe, 1)
})

test('pocket: device narrowed away from files is denied SUBSCRIBE, with the FROZEN code', async () => {
  const { handler, calls } = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd2', capabilities: ['device-admin'] } }),
  })
  const r = await handler('push.subscribe', { deviceId: 'd2', credential: 'c' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'capability-denied')
  assert.ok(Object.values(ERROR_CODES).includes(r.error.code), 'code must be in the frozen v1 vocabulary')
  assert.equal(calls.subscribe, 0, 'the subscribe closure must never run for a denied device')
})

test('pocket: push.test is files-gated like subscribe (content probe parity)', async () => {
  const ok = makeHandler()
  assert.equal((await ok.handler('push.test', { deviceId: 'd1', credential: 'c' })).ok, true)
  assert.equal(ok.calls.test, 1)
  const narrowed = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd2', capabilities: ['device-admin'] } }),
  })
  const r = await narrowed.handler('push.test', { deviceId: 'd2', credential: 'c' })
  assert.equal(r.error.code, 'capability-denied')
  assert.equal(narrowed.calls.test, 0)
  // never inside the unauthenticated fence
  const noAuth = makeHandler({ verifyDevice: async () => ({ error: 'auth-invalid' }) })
  assert.equal((await noAuth.handler('push.test', {})).error.code, 'auth-invalid')
})

test('pocket: push.status (delivery health) is files-gated and reaches the handler', async () => {
  const ok = makeHandler()
  const r = await ok.handler('push.status', { deviceId: 'd1', credential: 'c' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { subscriptions: [] })
  assert.equal(ok.calls.status, 1)
  // a device narrowed away from files may not read delivery health
  const narrowed = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd2', capabilities: ['device-admin'] } }),
  })
  const denied = await narrowed.handler('push.status', { deviceId: 'd2', credential: 'c' })
  assert.equal(denied.error.code, 'capability-denied')
  assert.equal(narrowed.calls.status, 0)
  // never inside the unauthenticated fence
  const noAuth = makeHandler({ verifyDevice: async () => ({ error: 'auth-invalid' }) })
  assert.equal((await noAuth.handler('push.status', {})).error.code, 'auth-invalid')
})

test('pocket: unsubscribe is NOT capability-gated - a narrowed device may always clean up', async () => {
  const { handler, calls } = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd2', capabilities: [] } }),
  })
  const r = await handler('push.unsubscribe', { deviceId: 'd2', credential: 'c' })
  assert.equal(r.ok, true, 'removing your own subscription is never a privilege')
  assert.equal(calls.unsubscribe, 1)
})

test('pocket: capability gate does not touch STATUS/TASKS for a verified device', async () => {
  const { handler } = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd3', capabilities: [] } }),
  })
  assert.equal((await handler('presence.status', { deviceId: 'd3', credential: 'c' })).ok, true)
  assert.equal((await handler('presence.tasks', { deviceId: 'd3', credential: 'c' })).ok, true)
})

test('pocket: unauthenticated read-only fence — allowed by default, closed under pocketStrict', async () => {
  const noAuth = { verifyDevice: async () => ({ error: 'auth-invalid' }) }
  const open = makeHandler(noAuth).handler
  assert.equal((await open('presence.status', {})).ok, true)
  assert.equal((await open('presence.tasks', {})).ok, true)
  assert.equal((await open('push.subscribe', {})).error.code, 'auth-invalid', 'the fence never covers push ops')

  const strict = makeHandler({ ...noAuth, pocketStrict: true }).handler
  assert.equal((await strict('presence.status', {})).error.code, 'auth-invalid')
  assert.equal((await strict('presence.tasks', {})).error.code, 'auth-invalid')
})

test('pocket: store corruption fails closed before everything else', async () => {
  const { handler } = makeHandler({ verifyDevice: async () => ({ error: 'store-corrupt' }) })
  assert.equal((await handler('presence.tasks', {})).error.code, 'store-corrupt')
})

test('pocket: unknown endpoint for a verified device is bad-request', async () => {
  const { handler } = makeHandler()
  assert.equal((await handler('nope', { deviceId: 'd1', credential: 'c' })).error.code, 'bad-request')
})

// ---------------------------------------------------------------- F5 redaction
// Unauthenticated TASKS inside the default (non-strict) fence must redact user
// content (title/summary) AT THE BOUNDARY while keeping every structural field
// a v1 consumer needs; authenticated callers keep full content.

function fullTask(over = {}) {
  return {
    taskId: 't1', sessionId: 's1', title: 'SECRET TITLE', state: 'RUNNING',
    summary: 'secret progress', systemHeartbeatAt: '2026-01-01T00:00:00.000Z',
    progressHeartbeatAt: '2026-01-01T00:01:00.000Z', startedAt: 1, updatedAt: 2,
    attention: null, staleReason: ['no meaningful progress for 21m'], sizeBytes: 4242,
    ...over,
  }
}

test('pocket: unauthenticated TASKS redact title/summary, structure intact', async () => {
  const real = fullTask()
  const { handler } = makeHandler({
    verifyDevice: async () => ({ error: 'auth-invalid' }),
    deps: { presence: { tasks: () => okEnv({ tasks: [real], orb: real }) } },
  })
  const r = await handler('presence.tasks', {})
  assert.equal(r.ok, true)
  assert.equal(r.value.tasks.length, 1)
  const t = r.value.tasks[0]
  assert.equal(t.title, UNAUTH_TITLE, 'title must become the placeholder')
  assert.equal(t.summary, '', 'summary must be emptied')
  // structural/user-content-free fields stay intact
  assert.equal(t.taskId, 't1')
  assert.equal(t.sessionId, 's1')
  assert.equal(t.state, 'RUNNING')
  assert.equal(t.systemHeartbeatAt, real.systemHeartbeatAt)
  assert.equal(t.progressHeartbeatAt, real.progressHeartbeatAt)
  assert.deepEqual(t.staleReason, real.staleReason)
  assert.equal(t.sizeBytes, 4242)
  assert.equal(r.value.orb.title, UNAUTH_TITLE, 'the orb DTO must be redacted too')
  // the response stays a valid v1 DTO and leaks no user content
  assert.deepEqual(validateTaskDTO(t), [], 'redacted DTO must satisfy the frozen schema')
  assert.ok(!JSON.stringify(r).includes('SECRET'), 'no user content may reach an unauthenticated caller')
})

test('pocket: authenticated TASKS keep full titles for every device', async () => {
  const real = fullTask()
  const { handler } = makeHandler({
    deps: { presence: { tasks: () => okEnv({ tasks: [real], orb: real }) } },
  })
  // capability-less device too: STATUS/TASKS are never capability-gated
  const strict = makeHandler({
    verifyDevice: async () => ({ ok: true, device: { id: 'd4', capabilities: [] } }),
    deps: { presence: { tasks: () => okEnv({ tasks: [real], orb: real }) } },
  })
  const r = await handler('presence.tasks', { deviceId: 'd1', credential: 'c' })
  assert.equal(r.value.tasks[0].title, 'SECRET TITLE')
  assert.equal(r.value.tasks[0].summary, 'secret progress')
  const r2 = await strict.handler('presence.tasks', { deviceId: 'd4', credential: 'c' })
  assert.equal(r2.value.tasks[0].title, 'SECRET TITLE', 'verified devices never see redacted content')
})

test('pocket: unauthenticated tasks ERROR envelopes pass through untouched', async () => {
  const { handler } = makeHandler({
    verifyDevice: async () => ({ error: 'auth-invalid' }),
    deps: { presence: { tasks: () => ({ ok: false, error: { code: 'sessions-unavailable', message: 'x', details: {} } }) } },
  })
  const r = await handler('presence.tasks', {})
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'sessions-unavailable')
})

test('redact helpers: pure functions keep shape, pass v1 validation, leave ok=false alone', () => {
  const real = fullTask()
  const dto = redactTaskDTO(real)
  assert.equal(dto.title, UNAUTH_TITLE)
  assert.equal(dto.summary, '')
  assert.equal(dto.taskId, 't1')
  assert.deepEqual(validateTaskDTO(dto), [])
  const value = redactTasksValue({ tasks: [real], orb: real, extra: 1 })
  assert.equal(value.tasks[0].title, UNAUTH_TITLE)
  assert.equal(value.orb.title, UNAUTH_TITLE)
  assert.equal(value.extra, 1, 'redaction must not drop sibling fields')
  const env = redactTasksEnvelope({ ok: true, value: { tasks: [real], orb: null } })
  assert.equal(env.value.tasks[0].summary, '')
  assert.equal(env.value.orb, null)
  const errEnv = redactTasksEnvelope({ ok: false, error: { code: 'x', message: 'm', details: {} } })
  assert.deepEqual(errEnv, { ok: false, error: { code: 'x', message: 'm', details: {} } })
  assert.equal(redactTasksEnvelope(null), null)
  assert.equal(redactTasksEnvelope(undefined), undefined)
})
