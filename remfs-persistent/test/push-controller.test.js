// Push dispatcher (push/controller.js) — the layer BETWEEN presence tasks and
// sendPush. It shipped without tests, and its sender call was positional while
// sendPush takes one options object: every real dispatch threw inside the
// cycle-level catch, so the dispatcher had NEVER delivered a push. These tests
// drive tick() through the REAL sendPush (fetch faked) so the calling
// convention can never silently drift again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPushStore } from '../lib/push/store.js'
import { createPushController } from '../lib/push/controller.js'
import { sendPush } from '../lib/push/webpush.js'
import { generateVapidKeys } from '../lib/push/vapid.js'
import { createECDH } from 'node:crypto'

function realishSub(i = 1) {
  // A REAL P-256 keypair for p256dh and a 16-byte auth secret, so the RFC 8291
  // encryption inside sendPush actually runs (a garbage key would throw and
  // hide a calling-convention bug behind a crypto error).
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    endpoint: `https://push.example.com/wpush/v2/sub-${i}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    },
  }
}

function needsUserTask(id = 's1') {
  return {
    ok: true,
    value: {
      tasks: [{ sessionId: id, taskId: id, state: 'NEEDS_USER', title: 'T', summary: 'S' }],
      orb: null,
    },
  }
}

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remfs-ctl-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = createPushStore({ file: path.join(dir, 'push.json') })
  return { store }
}

test('dispatch: tick() drives the REAL sendPush and delivers to the subscription endpoint', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  const fetched = []
  const controller = createPushController({
    tasks: async () => needsUserTask(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    // The real sender, only fetch is faked: a positional-call regression now
    // fails here instead of vanishing into "cycle failed".
    sender: (opts) => sendPush({ ...opts, fetchImpl: async (url, init) => { fetched.push({ url, init }); return { status: 201 } } }),
  })
  const r = await controller.tick()
  assert.equal(r.pushed, 1, 'one push must be delivered (cycle error: ' + (r.error || 'none') + ')')
  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].url, 'https://push.example.com/wpush/v2/sub-1')
  assert.match(String(fetched[0].init.headers.Authorization || fetched[0].init.headers.authorization), /vapid/i)
  assert.ok(Buffer.isBuffer(fetched[0].init.body) && fetched[0].init.body.length > 100, 'encrypted aes128gcm body present')
})

test('dispatch: dedupe - the same session:state is pushed once', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'zh')
  let sent = 0
  const controller = createPushController({
    tasks: async () => needsUserTask(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => { sent++; return { status: 'sent' } },
  })
  assert.equal((await controller.tick()).pushed, 1)
  assert.equal((await controller.tick()).pushed, 0, 'second cycle must dedupe')
  assert.equal(sent, 1)
})

test('dispatch: gone endpoint (404/410) is dropped, never retried', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  const controller = createPushController({
    tasks: async () => needsUserTask(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => ({ status: 'gone', httpStatus: 410 }),
  })
  await controller.tick()
  assert.equal((await store.subscriptions()).length, 0, 'expired subscription must be removed')
})
