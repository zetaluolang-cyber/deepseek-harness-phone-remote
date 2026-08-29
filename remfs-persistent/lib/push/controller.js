// push/controller.js — presence-driven Web Push dispatcher.
//
// The presence service has no event stream (the UI polls every 8s), so the
// dispatcher does the same: poll presence.tasks(), diff (sessionId:STATE)
// against the persisted dedupe map, and push NEEDS_USER / FAILED (always) and
// DONE (when enabled via remfs-options.json push.done). Notifications are
// delivered only to paired devices' subscriptions; the host composes the
// localized title/body so the Service Worker stays dumb and private.
import { sendPush } from './webpush.js'

const NOTIFY_ALWAYS = new Set(['NEEDS_USER', 'FAILED'])
const PRUNE_EVERY_MS = 60 * 1000

function labelsFor(lang) {
  return lang === 'zh'
    ? { NEEDS_USER: 'DeepSeek Harness 需要你', FAILED: 'Agent 失败了', DONE: '任务已完成', FALLBACK: 'DeepSeek Harness' }
    : { NEEDS_USER: 'DeepSeek Harness needs you', FAILED: 'Agent failed', DONE: 'Task completed', FALLBACK: 'DeepSeek Harness' }
}

/**
 * @param {Object} deps
 * @param {() => Promise<{ok:boolean,value?:{tasks:Array}}>} deps.tasks
 * @param {Object} deps.store - push store (alreadyPushed/markPushed/subscriptions/removeSubscription/pruneRevoked).
 * @param {(deviceId: string) => Promise<boolean>} deps.isDeviceValid - device-store membership check for pruning.
 * @param {{push:{done:boolean, intervalSeconds:number}}} deps.options
 * @param {(msg: string) => void} [deps.log=console.log]
 * @param {(endpoint:string, keys:any, payload:Buffer, vapid:any, subject:string, extra:any) => Promise<any>} [deps.sender=sendPush]
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
  const intervalMs = Math.max(5000, Math.min(60000, Number(pushOpts.intervalSeconds) || 10)) * 1000

  let timer = null
  let running = false
  let lastPrune = 0

  /** Run one dispatch cycle (exported for tests). */
  async function tick(now = Date.now()) {
    if (running) return { skipped: true }
    running = true
    try {
      const r = await tasks()
      if (!(r && r.ok) || !r.value || !Array.isArray(r.value.tasks)) return { skipped: false, pushed: 0 }
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
        const key = sessionId + ':' + state
        if (await store.alreadyPushed(key)) continue

        // One push per subscription; the title/body are localized per device.
        let sentAny = false
        for (const sub of subs) {
          const labels = labelsFor(sub.lang)
          const title = labels[state] || labels.FALLBACK
          const bodyParts = [task.title, task.summary].filter(Boolean)
          const payload = JSON.stringify({
            title,
            body: bodyParts.join(' — '),
            tag: 'remfs-push-' + sessionId,
            url: '/',
            sessionId,
          })
          const result = await sender(sub.endpoint, sub.keys, Buffer.from(payload, 'utf8'), vapid, subject, {
            ttlSeconds: 86400,
            urgency: state === 'NEEDS_USER' || state === 'FAILED' ? 'high' : 'normal',
          })
          if (result.status === 'sent') {
            sentAny = true
            pushed += 1
          } else if (result.status === 'gone') {
            // Endpoint expired (404/410): drop it, never retry.
            await store.removeSubscription(sub.deviceId, sub.endpoint)
            log('dropped expired subscription ' + sub.endpoint)
          } else {
            log('send failed (' + String(result.error || result.httpStatus) + ') ' + sub.endpoint)
          }
        }
        // Dedupe even when nothing was deliverable (avoids retry storms on a
        // temporarily failing push service; the 7-day prune bounds the map).
        await store.markPushed(key, now)
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

  return { start, stop, tick, intervalMs }
}
