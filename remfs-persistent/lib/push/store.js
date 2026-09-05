// push/store.js — durable Web Push state for the remfs presence channel.
//
// Single JSON file at ~/.dsh/remfs-push.json (path injectable for tests):
//   {
//     version: 1,
//     vapid:    { publicKeyB64, privateKeyPem, createdAt },  // generated once
//     subject:  'mailto:...' (operator-set),
//     subscriptions: [{
//       deviceId, lang, endpoint, keys:{p256dh,auth}, createdAt,
//       lastDeliveredAt,   // epoch ms of the last successful delivery (null)
//       lastError,         // string|null of the last failed send attempt
//       lastErrorAt,       // epoch ms of that failure (null)
//     }],
//     pushed:   { '<sessionId>:<STATE>:<turnCycle>': epochMs }  // dedupe, pruned
//   }
//
// Writes are atomic (temp file + rename). A corrupt file is moved aside to
// remfs-push.json.corrupt-<ts> and the store starts fresh (fail-closed
// security: stale subscriptions are never silently trusted).
import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateVapidKeys, originOf } from './vapid.js'

export const pushFile = () => path.join(os.homedir(), '.dsh', 'remfs-push.json')

const PUSHED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // dedupe memory: 7 days

/** Normalize a subscription object from the phone (fail-closed on bad shape). */
export function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null
  const endpoint = String(raw.endpoint || '')
  const keys = raw.keys || {}
  const p256dh = String(keys.p256dh || '')
  const auth = String(keys.auth || '')
  if (!/^https?:\/\//.test(endpoint)) return null
  if (!p256dh || !auth) return null
  return { endpoint, keys: { p256dh, auth } }
}

// Push providers the host is allowed to reach. Subscription endpoints are
// fetched BY THE HOST (SSRF + task-content exfiltration surface), so only
// well-known https push services are accepted — everything else is rejected at
// subscribe time with the frozen 'bad-request' code. Operators may extend the
// list via ~/.dsh/remfs-options.json `pushEndpointAllow` (bare hosts or https
// origins); matching is an exact hostname compare (no wildcard/subdomain).
export const KNOWN_PUSH_HOSTS = Object.freeze([
  'fcm.googleapis.com', // Google / Firebase Cloud Messaging
  'updates.push.services.mozilla.com', // Mozilla autopush
  'web.push.apple.com', // Apple Web Push
])

/** Parse an allowlist entry (https origin or bare host) into a hostname. */
export function normalizePushAllowEntry(entry) {
  const s = String(entry || '').trim()
  if (!s) return null
  try {
    const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? new URL(s) : new URL('https://' + s)
    return u.hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Decide whether a subscription endpoint may be stored and fetched by the
 * host. Accepts ONLY https endpoints whose hostname is a KNOWN_PUSH_HOSTS
 * entry or an operator extra-allowlist hostname.
 * @param {string} endpoint - the subscription endpoint URL.
 * @param {string[]} [extraAllow] - operator extra entries (hosts or origins).
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function allowedPushEndpoint(endpoint, extraAllow = []) {
  let url
  try {
    url = new URL(String(endpoint || ''))
  } catch {
    return { allowed: false, reason: 'push.subscribe: endpoint must be a valid https URL' }
  }
  if (url.protocol !== 'https:') {
    return { allowed: false, reason: 'push.subscribe: endpoint must use https (http endpoints are refused)' }
  }
  const host = url.hostname.toLowerCase()
  const extras = (Array.isArray(extraAllow) ? extraAllow : [])
    .map(normalizePushAllowEntry)
    .filter(Boolean)
  if (KNOWN_PUSH_HOSTS.includes(host) || extras.includes(host)) return { allowed: true }
  return {
    allowed: false,
    reason: 'push.subscribe: endpoint origin not on the push-provider allowlist (' + host + ')',
  }
}

/** Map store subscriptions to the /pocket push.status value for ONE device
 *  (owner-scoped: only the calling device's subscriptions are ever returned).
 *  @param {Array} subscriptions - store.subscriptions().
 *  @param {string} deviceId - the authenticated caller's device id.
 *  @returns {Array} [{ endpoint, origin, createdAt, lastDeliveredAt, lastError,
 *    lastErrorAt }] */
export function pushStatusForDevice(subscriptions, deviceId) {
  const list = Array.isArray(subscriptions) ? subscriptions : []
  const numOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  const out = []
  for (const s of list) {
    if (!s || String(s.deviceId) !== String(deviceId)) continue
    let origin = ''
    try { origin = originOf(s.endpoint) } catch { /* keep '' for malformed rows */ }
    out.push({
      endpoint: String(s.endpoint || ''),
      origin,
      createdAt: s.createdAt && typeof s.createdAt === 'string' ? s.createdAt : null,
      lastDeliveredAt: numOrNull(s.lastDeliveredAt),
      lastError: s.lastError == null ? null : String(s.lastError),
      lastErrorAt: numOrNull(s.lastErrorAt),
    })
  }
  return out
}

/**
 * Create the push store.
 * @param {Object} [opts] - { file = pushFile(), subject = 'mailto:admin@localhost' }.
 * @returns {Object} store API (all file I/O is lazy / on demand).
 */
export function createPushStore(opts = {}) {
  const file = opts.file || pushFile()
  const subject = opts.subject || 'mailto:admin@localhost'

  let data = null // lazily loaded

  async function load() {
    if (data !== null) return data
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /ENOENT|not found/i.test(String(e.code || e.message)))) {
        data = fresh()
        return data
      }
      // Corrupt / unreadable: quarantine and start fresh (never trust it).
      try {
        await rename(file, file + '.corrupt-' + Date.now())
      } catch { /* ignore */ }
      data = fresh()
      return data
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
      data = {
        version: 1,
        vapid: parsed.vapid || null,
        subject: parsed.subject || subject,
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        pushed: parsed.pushed && typeof parsed.pushed === 'object' ? parsed.pushed : {},
      }
    } catch {
      try {
        await rename(file, file + '.corrupt-' + Date.now())
      } catch { /* ignore */ }
      data = fresh()
    }
    return data
  }

  function fresh() {
    return { version: 1, vapid: null, subject, subscriptions: [], pushed: {} }
  }

  async function save() {
    const d = await load()
    const dir = path.dirname(file)
    await mkdir(dir, { recursive: true })
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    // F1: the store persists the VAPID PRIVATE KEY PEM - the tmp file must be
    // 0o600 so the rename never leaves a world-readable secret behind.
    await writeFile(tmp, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, file)
  }

  /** Ensure a VAPID keypair exists; returns { publicKeyB64, privateKey } and
   *  persists the PEM of the private half (the KeyObject cannot be serialized). */
  async function ensureVapid() {
    const d = await load()
    if (d.vapid && d.vapid.publicKeyB64 && d.vapid.privateKeyPem) {
      const { createPrivateKey } = await import('node:crypto')
      return {
        publicKeyB64: d.vapid.publicKeyB64,
        privateKey: createPrivateKey(d.vapid.privateKeyPem),
      }
    }
    const keys = generateVapidKeys()
    d.vapid = {
      publicKeyB64: keys.publicKeyB64,
      privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      createdAt: new Date().toISOString(),
    }
    await save()
    return { publicKeyB64: keys.publicKeyB64, privateKey: keys.privateKey }
  }

  /** @returns {{ publicKeyB64: string }|null} without materializing the private key. */
  async function vapidPublic() {
    const d = await load()
    if (d.vapid && d.vapid.publicKeyB64) return { publicKeyB64: d.vapid.publicKeyB64 }
    const { publicKeyB64 } = await ensureVapid()
    return { publicKeyB64 }
  }

  async function subjectOf() {
    const d = await load()
    return d.subject || subject
  }

  /** Add or replace (by endpoint) one device's subscription. */
  async function addSubscription(deviceId, sub, lang) {
    const d = await load()
    const idx = d.subscriptions.findIndex((s) => s.endpoint === sub.endpoint)
    const entry = {
      deviceId: String(deviceId),
      lang: lang === 'zh' ? 'zh' : 'en',
      endpoint: sub.endpoint,
      keys: sub.keys,
      createdAt: new Date().toISOString(),
      // Delivery health (1.3): stamped by the dispatcher/controller after each
      // send attempt; a fresh subscription has never been delivered to.
      lastDeliveredAt: null,
      lastError: null,
      lastErrorAt: null,
    }
    if (idx >= 0) d.subscriptions[idx] = entry
    else d.subscriptions.push(entry)
    await save()
    return { ok: true }
  }

  /** Persist one send-attempt outcome on a subscription (matched by endpoint).
   *  A successful delivery stamps lastDeliveredAt and clears the error fields;
   *  a failed attempt records lastError/lastErrorAt and leaves the last success
   *  intact. @param {Object} outcome - { deliveredAt?: number, error?: string,
   *  errorAt?: number }. */
  async function recordSendOutcome(endpoint, outcome = {}) {
    const d = await load()
    const sub = d.subscriptions.find((s) => s.endpoint === endpoint)
    if (!sub) return { ok: false, reason: 'no-such-endpoint' }
    const deliveredAt = Number(outcome.deliveredAt)
    if (Number.isFinite(deliveredAt) && deliveredAt > 0) {
      sub.lastDeliveredAt = deliveredAt
      sub.lastError = null
      sub.lastErrorAt = null
    }
    if (outcome.error != null) {
      sub.lastError = String(outcome.error)
      const errorAt = Number(outcome.errorAt)
      sub.lastErrorAt = Number.isFinite(errorAt) && errorAt > 0 ? errorAt : null
    }
    await save()
    return { ok: true }
  }

  /** Remove a subscription (by endpoint) or every subscription of a device. */
  async function removeSubscription(deviceId, endpoint) {
    const d = await load()
    const before = d.subscriptions.length
    if (endpoint) d.subscriptions = d.subscriptions.filter((s) => s.endpoint !== endpoint)
    else d.subscriptions = d.subscriptions.filter((s) => s.deviceId !== String(deviceId))
    if (d.subscriptions.length !== before) await save()
    return { ok: true, removed: before - d.subscriptions.length }
  }

  /** Drop subscriptions whose device is no longer in the device store. */
  async function pruneRevoked(isDeviceValid) {
    const d = await load()
    const before = d.subscriptions.length
    const kept = []
    for (const s of d.subscriptions) {
      try {
        if (await isDeviceValid(s.deviceId)) kept.push(s)
      } catch {
        kept.push(s) // validator errors are not revocation
      }
    }
    if (kept.length !== before) {
      d.subscriptions = kept
      await save()
    }
    return { removed: before - kept.length }
  }

  /** True when this (sessionId:STATE:turnCycle) has already been pushed. */
  async function alreadyPushed(key) {
    const d = await load()
    return Object.prototype.hasOwnProperty.call(d.pushed, key)
  }

  /** Remember a pushed key (now a sessionId:STATE:turnCycle triple), pruning
   *  entries older than PUSHED_MAX_AGE_MS. */
  async function markPushed(key, now = Date.now()) {
    const d = await load()
    d.pushed[key] = now
    for (const k of Object.keys(d.pushed)) {
      if (now - d.pushed[k] > PUSHED_MAX_AGE_MS) delete d.pushed[k]
    }
    await save()
  }

  /** All current subscriptions (array copy). */
  async function subscriptions() {
    const d = await load()
    return d.subscriptions.slice()
  }

  /** Test-only: drop the in-memory cache (force a re-read from disk). */
  async function reload() {
    data = null
    await load()
    return data
  }

  /** Remove the backing file (test cleanup). */
  async function destroy() {
    data = null
    try { await access(file) } catch { return }
    try { await (await import('node:fs/promises')).unlink(file) } catch { /* ignore */ }
  }

  return {
    file,
    ensureVapid,
    vapidPublic,
    subjectOf,
    addSubscription,
    removeSubscription,
    pruneRevoked,
    alreadyPushed,
    markPushed,
    recordSendOutcome,
    subscriptions,
    reload,
    destroy,
  }
}
