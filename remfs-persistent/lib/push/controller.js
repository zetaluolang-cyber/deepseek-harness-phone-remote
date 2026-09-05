// push/controller.js — presence-driven Web Push dispatcher.
//
// The presence service has no event stream (the UI polls every 8s), so the
// dispatcher does the same: poll presence.tasks(), diff against the persisted
// dedupe map, and push NEEDS_USER / FAILED (always) and DONE (when enabled via
// remfs-options.json push.done). Notifications are delivered only to paired
// devices' subscriptions; the host composes the localized title/body so the
// Service Worker stays dumb and private.
//
// Dedupe (1.1): keys are sessionId:STATE:turnCycle triples (turnCycle = the
// task DTO's user-role message count) persisted for 7 days, PLUS an in-memory
// per-session 2-minute cooldown. A repeat NEEDS_USER (multi-approval) or
// FAILED -> RUNNING -> FAILED re-notifies once the user started a NEW turn
// (turnCycle changed) or the cooldown elapsed; the same event inside one turn
// never spams. Send outcomes are recorded on each subscription (1.3) so the
// owning device can see "last delivered / last error" via /pocket push.status.
import { sendPush } from './webpush.js'

const NOTIFY_ALWAYS = new Set(['NEEDS_USER', 'FAILED'])
const PRUNE_EVERY_MS = 60 * 1000
/** Per-session cooldown: never push the same session twice within this window
 *  (repeated cycles must not spam), independent of the triple dedupe map. */
export const SESSION_PUSH_COOLDOWN_MS = 2 * 60 * 1000
/** A cycle still in flight after this long is treated as lost and its lock
 *  released. presence.tasks() decompresses every persisted session log, so
 *  a slow cycle is normal and the budget must be far above it; what this
 *  catches is a cycle that never returns at all. */
export const TICK_BUDGET_MS = 3 * 60 * 1000

/** Clamp a task turnCycle to a finite non-negative integer (0 when absent). */
export function normalizeTurnCycle(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** Build the localized JSON push payload for one task (exported for tests so
 *  the sessionId the Service Worker deep-links into is pinned). */
export function buildPushPayload(task, labels) {
  const state = String(task.state || '')
  const sessionId = String(task.sessionId || task.taskId || '')
  const title = labels[state] || labels.FALLBACK
  const bodyParts = [task.title, task.summary].filter(Boolean)
  return JSON.stringify({
    title,
    body: bodyParts.join(' — '),
    tag: 'remfs-push-' + sessionId,
    url: '/',
    sessionId,
  })
}

function labelsFor(lang) {
  return lang === 'zh'
    ? { NEEDS_USER: 'DeepSeek Harness 需要你', FAILED: 'Agent 失败了', DONE: '任务已完成', FALLBACK: 'DeepSeek Harness' }
    : { NEEDS_USER: 'DeepSeek Harness needs you', FAILED: 'Agent failed', DONE: 'Task completed', FALLBACK: 'DeepSeek Harness' }
}

/**
 * @param {Object} deps
 * @param {() => Promise<{ok:boolean,value?:{tasks:Array}}>} deps.tasks
 * @param {Object} deps.store - push store (alreadyPushed/markPushed/
 *   recordSendOutcome/subscriptions/removeSubscription/pruneRevoked).
 * @param {(deviceId: string) => Promise<boolean>} deps.isDeviceValid - device-store membership check for pruning.
 * @param {{push:{done:boolean, intervalSeconds:number}}} deps.options
 * @param {(msg: string) => void} [deps.log=console.log]
 * @param {(opts:{endpoint:string,keys:any,payload:Buffer,vapid:any,subject:string,extra:any}) => Promise<any>} [deps.sender=sendPush]
 */
export function createPushController(deps) {
  const {
    tasks,
    store,
    isDeviceValid,
    options,
    log = (m) => console.log('[remfs-persistent] push: ' + m),
    sender = sendPush,
  } = deps
  const pushOpts = (options && options.push) || {}
  const doneEnabled = !!pushOpts.done
  // The clamp is on SECONDS. It used to carry millisecond bounds and then
  // multiply by 1000 as well: Math.max(5000, Math.min(60000, 10)) is 5000,
  // so the default 10-second dispatcher actually ran every 5,000,000 ms -
  // 83 minutes. Nothing hung and nothing threw, so no log ever appeared;
  // the only symptom was a presence snapshot that looked frozen, which the
  // desktop companion had been reporting as 'cache stale' all along.
  const intervalSec = Math.max(5, Math.min(60, Number(pushOpts.intervalSeconds) || 10))
  const intervalMs = intervalSec * 1000

  let timer = null
  // A tick that THROWS is handled by the catch below. A tick that HANGS was
  // not handled at all: `running` stayed true, every later cycle returned
  // {skipped:true} immediately, and the dispatcher stopped forever with no
  // log, no push, and a presence snapshot frozen at its last success.
  // Observed live: 40 minutes stalled, then reproduced within ~90s of a
  // restart. The interval is the only thing that can notice, so it does:
  // a tick still in flight past this budget is declared lost, `running` is
  // released, and the next cycle starts fresh.
  let running = false
  let runStartedAt = 0
  let abandoned = 0
  // { code, count } while presence.tasks() keeps failing; null when healthy.
  let lastTasksError = null
  let lastPrune = 0
  // Per-session cooldown (in-memory; the persisted triple dedupe map survives
  // restarts): last tick time a push was dispatched for each sessionId.
  const lastPushAt = new Map()
  // Cached task snapshot: presence.tasks() decompresses every persisted
  // session log (zstd) and can take tens of seconds with real data, so the
  // dispatcher refreshes this snapshot once per cycle and the HTTP presence
  // route serves the CACHE instead of re-scanning per request.
  let lastSnapshot = null

  /**
   * The most recent successful task snapshot (or null before the first
   * cycle completes). Shape: { ok: true, value: { tasks, orb } }.
   */
  function snapshot() {
    return lastSnapshot
  }

  /** Run one dispatch cycle (exported for tests). */
  async function tick(now = Date.now()) {
    if (running) {
      const heldMs = now - runStartedAt
      if (runStartedAt > 0 && heldMs >= TICK_BUDGET_MS) {
        // The previous tick is past its budget. It may still resolve later;
        // its writes are idempotent (dedupe keys, atomic store writes), so
        // releasing the lock is safe and is the only way to recover.
        abandoned += 1
        log('previous cycle exceeded ' + Math.round(TICK_BUDGET_MS / 1000) + 's and was abandoned (' + abandoned + ' total) - starting a fresh cycle')
        running = false
        runStartedAt = 0
      } else {
        return { skipped: true }
      }
    }
    running = true
    runStartedAt = now
    try {
      const r = await tasks()
      if (r && r.ok && r.value) {
        lastSnapshot = { ok: true, value: r.value, cachedAt: new Date().toISOString() }
        if (lastTasksError) { log('presence recovered after ' + lastTasksError.count + ' failed cycle(s) (' + lastTasksError.code + ')'); lastTasksError = null }
      }
      if (!(r && r.ok) || !r.value || !Array.isArray(r.value.tasks)) {
        // A FAILING presence call used to be completely silent: lastSnapshot
        // simply stopped advancing while the HTTP route kept serving the last
        // good one as if it were current. From outside, a dispatcher whose
        // source went bad was indistinguishable from a quiet system - the
        // snapshot just froze, for 40 minutes, with an empty log.
        // The snapshot is deliberately KEPT (a consumer that can reason about
        // staleness, like the desktop companion, does better with old data
        // plus its own freshness check than with nothing), but the reason is
        // now on the record. Repeats are counted, not reprinted.
        const code = (r && r.error && r.error.code) || (r && r.ok ? 'malformed-tasks-envelope' : 'no-response')
        if (lastTasksError && lastTasksError.code === code) {
          lastTasksError.count += 1
          if (lastTasksError.count % 30 === 0) {
            log('presence still failing (' + code + ') after ' + lastTasksError.count + ' cycles; snapshot frozen at ' + (lastSnapshot ? lastSnapshot.cachedAt : 'never'))
          }
        } else {
          lastTasksError = { code, count: 1 }
          log('presence.tasks failed (' + code + ') - the served snapshot is now FROZEN at ' + (lastSnapshot ? lastSnapshot.cachedAt : 'never') + ' and no push can fire until it recovers')
        }
        return { skipped: false, pushed: 0, tasksError: code }
      }
      const vapid = await store.ensureVapid()
      const subject = await store.subjectOf()
      const subs = await store.subscriptions()
      let pushed = 0

      for (const task of r.value.tasks) {
        const state = String(task.state || '')
        const sessionId = String(task.sessionId || task.taskId || '')
        if (!sessionId) continue
        const notify = NOTIFY_ALWAYS.has(state) || (doneEnabled && state === 'DONE')
        if (!notify) continue
        // 1.1: dedupe on sessionId:STATE:turnCycle so a repeat NEEDS_USER /
        // FAILED re-notifies after a NEW user turn (cycle changed) while the
        // same cycle stays suppressed for 7 days.
        const cycle = normalizeTurnCycle(task.turnCycle)
        const key = sessionId + ':' + state + ':' + cycle
        if (await store.alreadyPushed(key)) continue
        // Per-session cooldown: do NOT mark the triple while suppressed — the
        // next cycle retries the same pending event once the window elapses.
        const lastSessionPush = lastPushAt.get(sessionId) || 0
        if (now - lastSessionPush < SESSION_PUSH_COOLDOWN_MS) continue

        // One push per subscription; the title/body are localized per device.
        let sentAny = false
        for (const sub of subs) {
          const labels = labelsFor(sub.lang)
          const payload = buildPushPayload(task, labels)
          // sendPush takes ONE options object. This call was positional until
          // 2026-08 — every argument landed in `opts` as a bare string, so the
          // dispatcher had never delivered a single real push; the cycle-level
          // catch swallowed the throw as "cycle failed". The calling
          // convention is now pinned by test/push-controller.test.js.
          const result = await sender({
            endpoint: sub.endpoint,
            keys: sub.keys,
            payload: Buffer.from(payload, 'utf8'),
            vapid,
            subject,
            extra: {
              ttlSeconds: 86400,
              urgency: state === 'NEEDS_USER' || state === 'FAILED' ? 'high' : 'normal',
            },
          })
          if (result.status === 'sent') {
            sentAny = true
            pushed += 1
            // Delivery health (1.3): a successful attempt stamps the last
            // delivery time and clears any prior error on this subscription.
            await store.recordSendOutcome(sub.endpoint, { deliveredAt: now })
          } else if (result.status === 'gone') {
            // Endpoint expired (404/410): drop it, never retry.
            await store.removeSubscription(sub.deviceId, sub.endpoint)
            log('dropped expired subscription ' + sub.endpoint)
          } else {
            // Failure keeps the subscription but is recorded so push.status
            // can show the owning device why delivery is failing.
            await store.recordSendOutcome(sub.endpoint, {
              error: String(result.error || result.httpStatus || 'send failed'),
              errorAt: now,
            })
            log('send failed (' + String(result.error || result.httpStatus) + ') ' + sub.endpoint)
          }
        }
        // Dedupe even when nothing was deliverable (avoids retry storms on a
        // temporarily failing push service; the 7-day prune bounds the map).
        await store.markPushed(key, now)
        lastPushAt.set(sessionId, now)
        if (sentAny) log(state + ' pushed for ' + sessionId + (task.title ? ' (' + task.title + ')' : ''))
      }

      // Periodic prune: a revoked device must stop receiving task titles.
      if (now - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = now
        const pruned = await store.pruneRevoked(isDeviceValid)
        if (pruned.removed > 0) log('pruned ' + pruned.removed + ' subscription(s) of revoked devices')
      }
      return { skipped: false, pushed }
    } catch (e) {
      log('cycle failed: ' + String((e && e.message) || e))
      return { skipped: false, pushed: 0, error: String((e && e.message) || e) }
    } finally {
      running = false
    }
  }

  /** Start the periodic dispatcher; returns the stop function. */
  function start() {
    if (timer !== null) return stop
    tick().catch(() => { /* first cycle best-effort */ })
    timer = setInterval(() => {
      tick().catch(() => { /* cycle failures are logged inside tick */ })
    }, intervalMs)
    return stop
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, stop, tick, intervalMs, snapshot }
}
