// Push store tests: subscriptions, VAPID persistence, dedupe, atomic writes,
// endpoint allowlist (1.2) and per-subscription delivery health (1.3).
// Run: node --test test/pushstore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createPushStore, normalizeSubscription, allowedPushEndpoint,
  normalizePushAllowEntry, pushStatusForDevice, KNOWN_PUSH_HOSTS,
} from '../lib/push/store.js'
import { generateVapidKeys } from '../lib/push/vapid.js'

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'remfs-push-'))
}

function fakeSub(i = 1) {
  const keys = generateVapidKeys() // any P-256 public point is a valid p256dh
  return {
    endpoint: `https://push.example.com/wpush/v2/sub-${i}`,
    keys: { p256dh: keys.publicKeyB64, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
  }
}

test('normalizeSubscription: accepts a valid subscription, rejects garbage', () => {
  const good = fakeSub()
  assert.ok(normalizeSubscription(good))
  assert.equal(normalizeSubscription({ endpoint: 'not-a-url', keys: good.keys }), null)
  assert.equal(normalizeSubscription({ endpoint: good.endpoint, keys: { p256dh: '', auth: '' } }), null)
  assert.equal(normalizeSubscription(null), null)
  assert.equal(normalizeSubscription('x'), null)
})

// ------------------------------------------------------------ 1.2 endpoint allowlist

test('endpoint allowlist: the three well-known push providers are accepted', () => {
  assert.deepEqual(
    allowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123'),
    { allowed: true })
  assert.deepEqual(
    allowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc123'),
    { allowed: true })
  assert.deepEqual(
    allowedPushEndpoint('https://web.push.apple.com/abc123'),
    { allowed: true })
  // https:// with a path/query on a known host is still the same origin
  assert.equal(KNOWN_PUSH_HOSTS.includes('fcm.googleapis.com'), true)
  assert.equal(KNOWN_PUSH_HOSTS.includes('updates.push.services.mozilla.com'), true)
  assert.equal(KNOWN_PUSH_HOSTS.includes('web.push.apple.com'), true)
})

test('endpoint allowlist: http, localhost, attacker and unknown hosts are rejected', () => {
  const expectReject = (endpoint) => {
    const r = allowedPushEndpoint(endpoint)
    assert.equal(r.allowed, false, 'must reject ' + endpoint)
    assert.match(r.reason, /push\.subscribe:/, 'rejection must carry a clear reason')
  }
  expectReject('http://fcm.googleapis.com/fcm/send/x') // https only, even on a known host
  expectReject('http://localhost:8080/wpush')
  expectReject('https://localhost:8443/wpush')
  expectReject('https://127.0.0.1/wpush')
  expectReject('https://attacker.com/wpush/v2/x')
  expectReject('https://push.example.com/wpush/v2/x')
  expectReject('https://fcm.googleapis.com.evil.com/x') // exact host compare, no subdomain trick
  expectReject('ftp://fcm.googleapis.com/x')
  expectReject('not-a-url')
  expectReject('')
})

test('endpoint allowlist: operator pushEndpointAllow entries are honored (hosts and https origins)', () => {
  const extra = ['https://push.example.com', 'wpush.corp.test', ' https://push.example.org ']
  assert.deepEqual(allowedPushEndpoint('https://push.example.com/wpush/v2/x', extra), { allowed: true })
  assert.deepEqual(allowedPushEndpoint('https://wpush.corp.test/v1/x', extra), { allowed: true })
  assert.deepEqual(allowedPushEndpoint('https://push.example.org/x', extra), { allowed: true })
  // extra allowlist never widens the scheme or matching rules
  assert.equal(allowedPushEndpoint('http://push.example.com/x', extra).allowed, false)
  assert.equal(allowedPushEndpoint('https://sub.push.example.com/x', extra).allowed, false)
  assert.equal(allowedPushEndpoint('https://attacker.com/x', extra).allowed, false)
  // junk entries fail closed (ignored, not fatal)
  assert.deepEqual(allowedPushEndpoint('https://fcm.googleapis.com/x', ['', 42, null]), { allowed: true })
})

test('endpoint allowlist: normalizePushAllowEntry maps origins and bare hosts to hostnames', () => {
  assert.equal(normalizePushAllowEntry('https://push.example.com'), 'push.example.com')
  assert.equal(normalizePushAllowEntry('HTTPS://Push.Example.COM/x'), 'push.example.com')
  assert.equal(normalizePushAllowEntry('wpush.corp.test'), 'wpush.corp.test')
  assert.equal(normalizePushAllowEntry(''), null)
  assert.equal(normalizePushAllowEntry(null), null)
  assert.equal(normalizePushAllowEntry('not a url'), null)
})

// ------------------------------------------------------------ 1.3 delivery health

test('store: subscriptions carry delivery-health fields; recordSendOutcome stamps them', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'push.json')
    const store = createPushStore({ file })
    await store.addSubscription('dev-1', fakeSub(1), 'zh')
    let sub = (await store.subscriptions())[0]
    assert.equal(sub.lastDeliveredAt, null)
    assert.equal(sub.lastError, null)
    // a successful delivery clears the error and stamps the time
    await store.recordSendOutcome(sub.endpoint, { deliveredAt: 1000 })
    sub = (await store.subscriptions())[0]
    assert.equal(sub.lastDeliveredAt, 1000)
    assert.equal(sub.lastError, null)
    // a failed attempt records the error and keeps the last success
    await store.recordSendOutcome(sub.endpoint, { error: 'network: ECONNREFUSED', errorAt: 2000 })
    sub = (await store.subscriptions())[0]
    assert.equal(sub.lastDeliveredAt, 1000, 'last success is preserved across a failure')
    assert.equal(sub.lastError, 'network: ECONNREFUSED')
    assert.equal(sub.lastErrorAt, 2000)
    // the next success clears the error again
    await store.recordSendOutcome(sub.endpoint, { deliveredAt: 3000 })
    sub = (await store.subscriptions())[0]
    assert.equal(sub.lastDeliveredAt, 3000)
    assert.equal(sub.lastError, null)
    // unknown endpoint is a no-op
    const miss = await store.recordSendOutcome('https://nope.example/x', { deliveredAt: 1 })
    assert.deepEqual(miss, { ok: false, reason: 'no-such-endpoint' })
    // persists across a reload (health survives controller restarts)
    await store.reload()
    sub = (await store.subscriptions())[0]
    assert.equal(sub.lastDeliveredAt, 3000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: pushStatusForDevice is owner-scoped and maps health fields', async () => {
  const dir = await tempDir()
  try {
    const store = createPushStore({ file: path.join(dir, 'push.json') })
    await store.addSubscription('dev-a', fakeSub(1), 'en')
    await store.addSubscription('dev-b', fakeSub(2), 'zh')
    const all = await store.subscriptions()
    await store.recordSendOutcome(all[0].endpoint, { deliveredAt: 1234 })
    await store.recordSendOutcome(all[1].endpoint, { error: 'http 500', errorAt: 5678 })
    // device A sees ONLY its own subscription
    const a = pushStatusForDevice(all, 'dev-a')
    assert.equal(a.length, 1)
    assert.equal(a[0].origin, 'https://push.example.com')
    assert.equal(a[0].createdAt, all[0].createdAt)
    assert.equal(a[0].lastDeliveredAt, 1234)
    assert.equal(a[0].lastError, null)
    assert.equal(a[0].lastErrorAt, null)
    assert.equal(a[0].endpoint, all[0].endpoint)
    // device B sees its own failure state
    const b = pushStatusForDevice(all, 'dev-b')
    assert.equal(b.length, 1)
    assert.equal(b[0].lastDeliveredAt, null)
    assert.equal(b[0].lastError, 'http 500')
    assert.equal(b[0].lastErrorAt, 5678)
    // unknown device sees nothing (owner scope: never another device's data)
    assert.deepEqual(pushStatusForDevice(all, 'dev-ghost'), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: VAPID keypair is generated once and persisted', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'push.json')
    const store = createPushStore({ file })
    const v1 = await store.ensureVapid()
    assert.ok(v1.publicKeyB64 && v1.privateKey)
    // reload from disk: same public key, private key recoverable
    await store.reload()
    const v2 = await store.ensureVapid()
    assert.equal(v2.publicKeyB64, v1.publicKeyB64)
    const pub = await store.vapidPublic()
    assert.equal(pub.publicKeyB64, v1.publicKeyB64)
    const raw = JSON.parse(await readFile(file, 'utf8'))
    assert.ok(raw.vapid.privateKeyPem.includes('PRIVATE KEY'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: add replaces by endpoint; remove by endpoint and by device', async () => {
  const dir = await tempDir()
  try {
    const store = createPushStore({ file: path.join(dir, 'push.json') })
    await store.addSubscription('dev-1', fakeSub(1), 'zh')
    await store.addSubscription('dev-1', fakeSub(2), 'en')
    await store.addSubscription('dev-2', fakeSub(3), 'zh') // distinct endpoint, other device
    let subs = await store.subscriptions()
    assert.equal(subs.length, 3)
    // replace by endpoint keeps one entry, updates lang
    await store.addSubscription('dev-3', fakeSub(1), 'en')
    subs = await store.subscriptions()
    assert.equal(subs.length, 3)
    const replaced = subs.find((s) => s.endpoint.endsWith('sub-1'))
    assert.equal(replaced.deviceId, 'dev-3')
    assert.equal(replaced.lang, 'en')
    // remove one endpoint
    await store.removeSubscription('dev-3', subs.find((s) => s.endpoint.endsWith('sub-2')).endpoint)
    subs = await store.subscriptions()
    assert.equal(subs.length, 2)
    // remove all of a device
    await store.removeSubscription('dev-2')
    subs = await store.subscriptions()
    assert.equal(subs.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: pruneRevoked drops subscriptions of invalid devices', async () => {
  const dir = await tempDir()
  try {
    const store = createPushStore({ file: path.join(dir, 'push.json') })
    await store.addSubscription('alive', fakeSub(1), 'zh')
    await store.addSubscription('revoked', fakeSub(2), 'en')
    const r = await store.pruneRevoked(async (deviceId) => deviceId === 'alive')
    assert.equal(r.removed, 1)
    const subs = await store.subscriptions()
    assert.equal(subs.length, 1)
    assert.equal(subs[0].deviceId, 'alive')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: pushed dedupe marks and prunes after 7 days', async () => {
  const dir = await tempDir()
  try {
    const store = createPushStore({ file: path.join(dir, 'push.json') })
    assert.equal(await store.alreadyPushed('s1:NEEDS_USER'), false)
    await store.markPushed('s1:NEEDS_USER', 1_000_000)
    assert.equal(await store.alreadyPushed('s1:NEEDS_USER'), true)
    // a second key is kept; an old key is pruned during the next mark
    await store.markPushed('s2:DONE', 1_000_000)
    await store.markPushed('s3:FAILED', 1_000_000 + 8 * 24 * 60 * 60 * 1000)
    assert.equal(await store.alreadyPushed('s1:NEEDS_USER'), false)
    assert.equal(await store.alreadyPushed('s3:FAILED'), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('store: corrupt file is quarantined and the store starts fresh', async () => {
  const dir = await tempDir()
  try {
    const file = path.join(dir, 'push.json')
    await (await import('node:fs/promises')).writeFile(file, '{ not json', 'utf8')
    const store = createPushStore({ file })
    const subs = await store.subscriptions()
    assert.deepEqual(subs, [])
    const entries = await (await import('node:fs/promises')).readdir(dir)
    assert.ok(entries.some((e) => e.startsWith('push.json.corrupt-')), 'corrupt file moved aside')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
