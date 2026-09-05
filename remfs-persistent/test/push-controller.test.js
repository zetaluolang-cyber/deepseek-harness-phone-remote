// Push dispatcher (push/controller.js) — the layer BETWEEN presence tasks and
// sendPush. It shipped without tests, and its sender call was positional while
// sendPush takes one options object: every real dispatch threw inside the
// cycle-level catch, so the dispatcher had NEVER delivered a push. These tests
// drive tick() through the REAL sendPush (fetch faked) so the calling
// convention can never silently drift again. They also pin the 1.1 dedupe
// (sessionId:STATE:turnCycle triple + per-session 2-minute cooldown), the
// per-subscription delivery health (1.3) and the sessionId-carrying payload.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPushStore } from '../lib/push/store.js'
import { createPushController, buildPushPayload, normalizeTurnCycle, SESSION_PUSH_COOLDOWN_MS, TICK_BUDGET_MS } from '../lib/push/controller.js'
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

/** Task snapshot with an explicit state and turnCycle (1.1 fixtures). */
function taskWith(id, state, turnCycle, title = 'T') {
  return {
    ok: true,
    value: {
      tasks: [{ sessionId: id, taskId: id, state, turnCycle, title, summary: 'S' }],
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

// ------------------------------------------------- 1.1 payload + turn-cycle dedupe

test('dispatch: the push payload always carries the target sessionId (deep-link)', () => {
  const labels = { NEEDS_USER: 'Needs you', FAILED: 'Failed', DONE: 'Done', FALLBACK: 'Fallback' }
  const p = JSON.parse(buildPushPayload(
    { sessionId: 'session-abc', taskId: 'session-abc', state: 'NEEDS_USER', title: 'Fix fs', summary: 'working' },
    labels,
  ))
  assert.equal(p.sessionId, 'session-abc', 'the SW needs the sessionId to deep-link into the session')
  assert.equal(p.title, 'Needs you')
  assert.equal(p.body, 'Fix fs — working')
  assert.equal(p.tag, 'remfs-push-session-abc')
  assert.equal(p.url, '/')
  // FAILED falls back to the language table like the dispatcher does
  const f = JSON.parse(buildPushPayload({ sessionId: 's2', state: 'FAILED' }, labels))
  assert.equal(f.sessionId, 's2')
})

test('normalizeTurnCycle: clamps any input to a finite non-negative integer', () => {
  assert.equal(normalizeTurnCycle(0), 0)
  assert.equal(normalizeTurnCycle(3), 3)
  assert.equal(normalizeTurnCycle('3.9'), 3)
  assert.equal(normalizeTurnCycle(-1), 0)
  assert.equal(normalizeTurnCycle(undefined), 0)
  assert.equal(normalizeTurnCycle(NaN), 0)
  assert.equal(normalizeTurnCycle(Infinity), 0)
})

test('dispatch: a repeat NEEDS_USER after a NEW user turn (turnCycle+1) is pushed again', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'zh')
  let sent = 0
  // tasksNow is mutable: the controller captures `() => tasksNow()` at
  // construction, so later ticks can present a NEW task snapshot.
  let tasksNow = () => taskWith('s1', 'NEEDS_USER', 1)
  const controller = createPushController({
    tasks: () => tasksNow(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => { sent++; return { status: 'sent' } },
  })
  const t0 = 1_000_000
  // first NEEDS_USER (cycle 1)
  assert.equal((await controller.tick(t0)).pushed, 1)
  // still waiting at the SAME cycle, long after any cooldown -> dedupe holds
  assert.equal((await controller.tick(t0 + 10 * 60 * 1000)).pushed, 0)
  // the user answers -> a new user message -> cycle 2 -> re-notify
  tasksNow = () => taskWith('s1', 'NEEDS_USER', 2)
  assert.equal((await controller.tick(t0 + 11 * 60 * 1000)).pushed, 1, 'a new turn must re-notify')
  assert.equal(sent, 2)
})

test('dispatch: per-session cooldown suppresses rapid repeats and retries after 2 minutes', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  let sent = 0
  let tasksNow = () => taskWith('s1', 'FAILED', 1)
  const controller = createPushController({
    tasks: () => tasksNow(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => { sent++; return { status: 'sent' } },
  })
  const t0 = 1_000_000
  assert.equal((await controller.tick(t0)).pushed, 1)
  // FAILED -> RUNNING -> FAILED again, but still inside the same user turn
  // (cycle 1) AND inside the 2-minute cooldown: suppressed, not spammed.
  tasksNow = () => taskWith('s1', 'RUNNING', 1)
  assert.equal((await controller.tick(t0 + 10_000)).pushed, 0, 'RUNNING is not notify-worthy')
  tasksNow = () => taskWith('s1', 'FAILED', 1)
  assert.equal((await controller.tick(t0 + 30_000)).pushed, 0, 'same-session push inside the cooldown must be skipped')
  assert.equal(sent, 1, 'no spamming push was sent during the cooldown')
  // once the cooldown window elapsed AND the state re-appears at cycle 1, the
  // persisted triple dedupe still holds - only a NEW cycle re-notifies
  assert.equal((await controller.tick(t0 + 5 * 60 * 1000)).pushed, 0, 'same triple stays deduped for 7 days')
  assert.equal(sent, 1)
})

test('dispatch: cooldown-boundary retry - a NEW cycle suppressed by the cooldown is delivered after it', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'zh')
  let sent = 0
  let tasksNow = () => taskWith('s1', 'NEEDS_USER', 1)
  const controller = createPushController({
    tasks: () => tasksNow(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => { sent++; return { status: 'sent' } },
  })
  const t0 = 1_000_000
  assert.equal((await controller.tick(t0)).pushed, 1)
  // the user replies quickly (30s later) -> cycle 2, but inside the cooldown
  tasksNow = () => taskWith('s1', 'NEEDS_USER', 2)
  assert.equal((await controller.tick(t0 + 30_000)).pushed, 0, 'cycle 2 is real but must wait out the cooldown')
  assert.equal(sent, 1)
  // the dispatcher keeps polling; once 2 minutes have passed the pending
  // cycle-2 event is delivered (it was never marked while suppressed)
  assert.equal((await controller.tick(t0 + SESSION_PUSH_COOLDOWN_MS + 10_000)).pushed, 1)
  assert.equal(sent, 2)
  // and now the cycle-2 triple is marked: no third push while it persists
  assert.equal((await controller.tick(t0 + 60 * 60 * 1000)).pushed, 0)
  assert.equal(sent, 2)
})

// ------------------------------------------------------------ 1.3 delivery health

test('dispatch: successful sends stamp lastDeliveredAt; failures stamp lastError', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  // first cycle fails to deliver: the subscription is kept and marked failed
  let tasksNow = () => taskWith('s1', 'NEEDS_USER', 1)
  const failing = createPushController({
    tasks: () => tasksNow(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => ({ status: 'failed', error: 'http 500' }),
  })
  const t0 = Date.now()
  await failing.tick(t0)
  let sub = (await store.subscriptions())[0]
  assert.equal(sub.lastDeliveredAt, null)
  assert.equal(sub.lastError, 'http 500')
  assert.ok(sub.lastErrorAt >= t0, 'the failure time is recorded')
  // next cycle delivers: success clears the error and stamps the delivery time
  tasksNow = () => taskWith('s1', 'NEEDS_USER', 2)
  const ok = createPushController({
    tasks: () => tasksNow(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => ({ status: 'sent' }),
  })
  await ok.tick(t0 + 10 * 60 * 1000)
  sub = (await store.subscriptions())[0]
  assert.ok(sub.lastDeliveredAt >= t0 + 10 * 60 * 1000, 'a delivered push stamps lastDeliveredAt')
  assert.equal(sub.lastError, null, 'a success clears the recorded error')
  assert.equal(sub.lastErrorAt, null)
})

// ------------------------------------------------- hung-cycle watchdog
// Observed live: the dispatcher stopped for 40 minutes and reproduced within
// ~90s of a restart. A tick that THREW was caught; a tick that HUNG held
// `running` forever, so every later cycle returned {skipped:true} with no log,
// no push, and a presence snapshot frozen at its last success.
test('dispatch: a hung cycle is abandoned after the budget so the loop recovers', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  let calls = 0
  let sent = 0
  const controller = createPushController({
    // First call never resolves (the real hang); later calls answer normally.
    tasks: () => {
      calls++
      if (calls === 1) return new Promise(() => {})
      return Promise.resolve(needsUserTask())
    },
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: () => {},
    sender: async () => { sent++; return { status: 'sent' } },
  })
  const t0 = 1_000_000
  // The hung cycle starts and does not return.
  const hung = controller.tick(t0)
  assert.equal(calls, 1)
  // Inside the budget the lock still holds - a slow cycle must not be killed.
  assert.deepEqual(await controller.tick(t0 + TICK_BUDGET_MS - 1000), { skipped: true },
    'a cycle inside its budget must keep the lock')
  assert.equal(calls, 1, 'no new cycle may start while the previous one is still within budget')
  // Past the budget the lock is released and a fresh cycle runs to completion.
  const recovered = await controller.tick(t0 + TICK_BUDGET_MS + 1000)
  assert.equal(calls, 2, 'a fresh cycle must start once the hung one is abandoned')
  assert.equal(recovered.pushed, 1, 'the recovered cycle must actually deliver')
  assert.equal(sent, 1)
  // The abandoned promise is still pending; nothing above awaited it.
  assert.ok(hung instanceof Promise)
})

test('dispatch: a normal cycle releases its lock immediately (no false abandon)', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  let abandonLogs = 0
  const controller = createPushController({
    tasks: async () => needsUserTask(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: (m) => { if (/abandon/i.test(m)) abandonLogs++ },
    sender: async () => ({ status: 'sent' }),
  })
  await controller.tick(1_000_000)
  await controller.tick(1_000_000 + 10_000)
  assert.equal(abandonLogs, 0, 'a healthy cycle must never be reported as abandoned')
})

test('dispatch: a failing presence source is logged, not silently frozen', async (t) => {
  const { store } = await setup(t)
  await store.addSubscription('dev1', realishSub(1), 'en')
  const logs = []
  let mode = 'ok'
  const controller = createPushController({
    tasks: async () => (mode === 'ok'
      ? needsUserTask()
      : { ok: false, error: { code: 'sessions-unavailable', message: 'shape drift' } }),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds: 10 } },
    log: (m) => logs.push(m),
    sender: async () => ({ status: 'sent' }),
  })
  await controller.tick(1_000_000)
  const good = controller.snapshot()
  assert.ok(good && good.cachedAt, 'a healthy cycle must produce a snapshot')

  // The source goes bad: the snapshot is kept (consumers reason about
  // staleness themselves) but the reason must reach the log ONCE.
  mode = 'bad'
  const r = await controller.tick(1_010_000)
  assert.equal(r.tasksError, 'sessions-unavailable')
  assert.equal(controller.snapshot().cachedAt, good.cachedAt, 'the stale snapshot is kept, not cleared')
  const first = logs.filter((m) => /presence\.tasks failed/.test(m))
  assert.equal(first.length, 1, 'the first failure must be logged exactly once')
  assert.match(first[0], /sessions-unavailable/)
  assert.match(first[0], /FROZEN/)

  // Repeats are counted, not reprinted - a 10s loop must not spam the log.
  for (let i = 2; i <= 20; i++) await controller.tick(1_010_000 + i * 10_000)
  assert.equal(logs.filter((m) => /presence\.tasks failed/.test(m)).length, 1,
    'a persistent failure must not reprint every cycle')

  // Recovery is announced, so the log shows the outage had an end.
  mode = 'ok'
  await controller.tick(1_400_000)
  assert.equal(logs.filter((m) => /presence recovered/.test(m)).length, 1)
  assert.notEqual(controller.snapshot().cachedAt, good.cachedAt, 'recovery must refresh the snapshot')
})

test('dispatch: the poll interval is seconds, clamped to 5..60 - not 83 minutes', async (t) => {
  const { store } = await setup(t)
  const make = (intervalSeconds) => createPushController({
    tasks: async () => needsUserTask(),
    store,
    isDeviceValid: async () => true,
    options: { push: { done: false, intervalSeconds } },
    log: () => {},
    sender: async () => ({ status: 'sent' }),
  })
  // The clamp used to carry millisecond bounds AND multiply by 1000, so every
  // input collapsed to 5_000_000ms. The dispatcher looked healthy - no hang,
  // no throw, no log - while only running about once every 83 minutes.
  assert.equal(make(undefined).intervalMs, 10_000, 'the default must be 10 seconds')
  assert.equal(make(10).intervalMs, 10_000)
  assert.equal(make(30).intervalMs, 30_000, 'a configured value must be honoured')
  assert.equal(make(5).intervalMs, 5_000, 'lower bound')
  assert.equal(make(60).intervalMs, 60_000, 'upper bound')
  assert.equal(make(1).intervalMs, 5_000, 'below the floor clamps up, never down to nothing')
  assert.equal(make(600).intervalMs, 60_000, 'above the ceiling clamps down')
  assert.equal(make('bogus').intervalMs, 10_000, 'garbage falls back to the default')
  for (const v of [undefined, 10, 30, 5, 60, 1, 600]) {
    assert.ok(make(v).intervalMs <= 60_000, 'no input may ever exceed a minute, got ' + make(v).intervalMs)
  }
})