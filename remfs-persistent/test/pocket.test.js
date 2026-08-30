// Authorization rules of the /pocket dispatcher (presence/pocket.js).
// These were untestable while the handler lived inline in host.js apply() —
// which is how push ops shipped with no capability gate at all (the PR #3
// "known debt"). Every rule is pinned here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPocketHandler } from '../lib/presence/pocket.js'
import { ERROR_CODES } from '../lib/presence/api.js'

const okEnv = (value) => ({ ok: true, value })

function makeHandler(over = {}) {
  const calls = { subscribe: 0, unsubscribe: 0, test: 0 }
  const handler = createPocketHandler({
    presence: {
      status: (device) => okEnv({ who: device ? device.id : null }),
      tasks: () => okEnv({ tasks: [] }),
    },
    verifyDevice: over.verifyDevice || (async () => ({ ok: true, device: { id: 'd1', capabilities: ['files', 'device-admin'] } })),
    pocketStrict: over.pocketStrict || false,
    pushSubscribe: async () => { calls.subscribe++; return okEnv({ subscribed: true }) },
    pushUnsubscribe: async () => { calls.unsubscribe++; return okEnv({ removed: 1 }) },
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
