// push/subscribe.js tests: subscribe-time endpoint allowlist + best-effort
// reachability probe (1.2/1.4). The probe is faked exactly like sendPush's
// fetch in the other push tests; the allowlist decision itself is faked here
// and unit-tested for real in test/pushstore.test.js.
// Run: node --test test/push-subscribe.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handlePushSubscribeRequest } from '../lib/push/subscribe.js'

const okSub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'x'.repeat(43), auth: 'y'.repeat(22) },
}

function makeDeps(over = {}) {
  const calls = { add: [], probe: [] }
  const deps = {
    addSubscription: async (deviceId, sub, lang) => { calls.add.push({ deviceId, sub, lang }); return { ok: true } },
    probeEndpoint: async (endpoint) => { calls.probe.push(endpoint); return { reachable: true } },
    ...over,
  }
  return { deps, calls }
}

test('push.subscribe: a disallowed endpoint is rejected with the FROZEN bad-request code', async () => {
  const { deps, calls } = makeDeps({
    isEndpointAllowed: () => ({ allowed: false, reason: 'push.subscribe: endpoint origin not on the push-provider allowlist (attacker.com)' }),
  })
  const r = await handlePushSubscribeRequest(deps, { id: 'd1' }, { subscription: okSub, lang: 'zh' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'bad-request')
  assert.match(r.error.message, /attacker\.com/)
  assert.equal(calls.add.length, 0, 'a rejected endpoint must never be persisted')
  assert.equal(calls.probe.length, 0, 'no probe for a rejected endpoint')
})

test('push.subscribe: invalid payload shape is bad-request before any policy runs', async () => {
  const { deps, calls } = makeDeps()
  const r = await handlePushSubscribeRequest(deps, { id: 'd1' }, { subscription: null })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'bad-request')
  assert.equal(calls.add.length, 0)
  assert.equal(calls.probe.length, 0)
})

test('push.subscribe: reachable provider subscribes without a warning', async () => {
  const { deps, calls } = makeDeps({
    isEndpointAllowed: () => ({ allowed: true }),
  })
  const r = await handlePushSubscribeRequest(deps, { id: 'd1' }, { subscription: okSub, lang: 'en' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { subscribed: true, endpoint: okSub.endpoint })
  assert.equal(r.value.reachabilityWarning, undefined, 'no warning when the origin answers')
  assert.equal(calls.probe.length, 1)
  assert.equal(calls.add.length, 1)
  assert.equal(calls.add[0].deviceId, 'd1')
  assert.equal(calls.add[0].lang, 'en')
  assert.equal(calls.add[0].sub.endpoint, okSub.endpoint)
})

test('push.subscribe: an unreachable origin still subscribes, with a reachabilityWarning', async () => {
  const { deps, calls } = makeDeps({
    isEndpointAllowed: () => ({ allowed: true }),
    probeEndpoint: async () => ({ reachable: false, reason: 'origin timed out after 4000ms' }),
  })
  const r = await handlePushSubscribeRequest(deps, { id: 'd1' }, { subscription: okSub, lang: 'zh' })
  assert.equal(r.ok, true, 'a probe failure must NEVER block the subscribe (FCM may be unreachable from some networks)')
  assert.equal(r.value.subscribed, true)
  assert.equal(r.value.reachabilityWarning, 'origin timed out after 4000ms')
  assert.equal(calls.add.length, 1, 'the subscription is persisted despite the probe failure')
})

test('push.subscribe: a throwing probe degrades into a warning, never an error', async () => {
  const { deps, calls } = makeDeps({
    isEndpointAllowed: () => ({ allowed: true }),
    probeEndpoint: async () => { throw new Error('DNS lookup failed') },
  })
  const r = await handlePushSubscribeRequest(deps, { id: 'd1' }, { subscription: okSub })
  assert.equal(r.ok, true)
  assert.match(r.value.reachabilityWarning, /DNS lookup failed/)
  assert.equal(calls.add.length, 1)
})
