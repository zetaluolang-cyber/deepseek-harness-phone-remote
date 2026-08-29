// push/store.js — durable Web Push state for the remfs presence channel.
//
// Single JSON file at ~/.dsh/remfs-push.json (path injectable for tests):
//   {
//     version: 1,
//     vapid:    { publicKeyB64, privateKeyPem, createdAt },  // generated once
//     subject:  'mailto:...' (operator-set),
//     subscriptions: [{ deviceId, lang, endpoint, keys:{p256dh,auth}, createdAt }],
//     pushed:   { '<sessionId>:<STATE>': epochMs }           // dedupe, pruned
//   }
//
// Writes are atomic (temp file + rename). A corrupt file is moved aside to
// remfs-push.json.corrupt-<ts> and the store starts fresh (fail-closed
// security: stale subscriptions are never silently trusted).
import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateVapidKeys } from './vapid.js'

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
    await writeFile(tmp, JSON.stringify(d, null, 2), 'utf8')
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
    }
    if (idx >= 0) d.subscriptions[idx] = entry
    else d.subscriptions.push(entry)
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

  /** True when this (sessionId:STATE) has already been pushed. */
  async function alreadyPushed(key) {
    const d = await load()
    return Object.prototype.hasOwnProperty.call(d.pushed, key)
  }

  /** Remember a pushed key, pruning entries older than PUSHED_MAX_AGE_MS. */
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
    subscriptions,
    reload,
    destroy,
  }
}
