// Push store tests: subscriptions, VAPID persistence, dedupe, atomic writes.
// Run: node --test test/pushstore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPushStore, normalizeSubscription } from '../lib/push/store.js'
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
