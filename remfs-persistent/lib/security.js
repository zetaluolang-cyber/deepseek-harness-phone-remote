// security.js — application-level authentication and filesystem capability
// helpers for the /remfs channel. Pure Node (no Cordis), so the same code is
// unit-tested by `node --test` and used by the host half.
//
// Trust model:
//   transport (Tailscale / trusted-host)  = WHO can reach the channel
//   pairing + device credentials          = WHO is allowed to USE it
//   allowlist + protected paths           = WHAT they may touch
//
// Only SHA-256 hashes of credentials are persisted. The pairing code is
// one-time and short-lived.
//
// Concurrency: every store access runs through a per-file mutation lock and
// the store file is replaced atomically (tmp + rename), so concurrent
// verifyDevice/revokeDevice/pairDevice calls cannot resurrect a revoked
// credential or double-consume a pairing code.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------- constants

// Default capabilities for a newly paired device (the Pocket Cockpit concept
// was removed; 'files' + 'approval' remain the baseline).
export const DEFAULT_DEVICE_CAPABILITIES = Object.freeze(['files', 'approval'])

export const PAIRING_TTL_MS = 10 * 60 * 1000 // pairing code validity
export const CREDENTIAL_BYTES = 32 // long-term device credential (256-bit)
export const CODE_GROUPS = 8 // display groups for the pairing code
export const CODE_GROUP_CHARS = 4 // hex chars per group (128-bit typable code)

// Protected path segments (any position) and protected file name patterns.
// SOFT-DENY: directory segments that block access by default, but a workspace
// registered EXACTLY under one of them may be reachable (the phone can still
// read a folder the PC user deliberately registered). These are user-data
// privacy boundaries (WeChat/WPS/AppData), not credentials or system files.
export const DENY_SEGMENTS = new Set([
  'system volume information', '$recycle.bin', 'recovery', 'config.msi', '$sysreset',
  'perflogs', 'msocache', 'windows.old', '$winreagent',
  'program files', 'program files (x86)', 'programdata',
  'appdata', 'application data',
  'xwechat_files', 'kingsoftdata', 'wpscloudsvr', 'tencent files',
])

// HARD-DENY directory segments: system directories that must NEVER be
// reachable remotely, even when a workspace is registered under a parent
// protected directory. Registering C:\Windows as a workspace must not expose
// System32/SysWOW64 (system files, drivers, binaries).
export const HARD_DENY_SEGMENTS = new Set(['windows', 'system32', 'syswow64'])

// HARD-DENY file patterns: credentials, private keys and system files. These
// are NEVER reachable even when the parent protected directory (e.g. .ssh,
// .aws) is registered as a workspace.
export const DENY_FILE = /(^|[/\\])\.ssh([/\\]|$)|(^|[/\\])\.git([/\\]|$)|(^|[/\\])\.aws([/\\]|$)|(^|[/\\])\.gnupg([/\\]|$)|(^|[/\\])\.config[/\\]gcloud([/\\]|$)|(^|[/\\])\.env(\.[a-z0-9_-]+)?$|(^|[/\\])id_(rsa|ed25519|dsa|ecdsa)(\.pub)?$|\.(pem|key|pfx|p12)$|(^|[/\\])\.credentials\.ya?ml$|(^|[/\\])ntuser\.dat$|^[A-Za-z]:[/\\](sam|system|security)(\.|$)/i

export const ERR = {
  AUTH_REQUIRED: 'auth-required',
  AUTH_INVALID: 'auth-invalid',
  STORE_CORRUPT: 'store-corrupt',
  PAIRING_INVALID: 'pairing-invalid',
  PAIRING_EXPIRED: 'pairing-expired',
  PAIRING_USED: 'pairing-used',
  DEVICE_NOT_FOUND: 'device-not-found',
  DEVICE_REVOKED: 'device-revoked',
  ROOT_OUTSIDE: 'root-outside-approved',
  PATH_TRAVERSAL: 'path-traversal',
  PATH_PROTECTED: 'path-protected',
  PATH_OUTSIDE: 'path-outside-allowed',
  ENCODING_NOT_UTF8: 'encoding-not-utf8',
}

// ------------------------------------------------------------------- paths

/**
 * Normalize a path for SECURITY comparisons: canonicalize every separator
 * ('/' and '\') to backslash (Windows-first project), lowercase, and strip
 * trailing separators. Mixed separators (C:/Users/x vs C:\Users\x) must have
 * identical containment semantics on every platform.
 */
export function normPath(p) {
  return String(p || '').replace(/[\\/]/g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** True when the raw path contains '..' segments or is a UNC path. */
export function hasTraversal(p) {
  const s = String(p || '')
  if (/^\\\\|^\/\//.test(s)) return true // UNC / network path
  const segs = s.split(/[\\/]/)
  return segs.some((seg) => seg === '..')
}

/** True when normalized `p` is equal to or inside one of `roots`. */
export function isWithin(p, roots) {
  const pn = normPath(p)
  if (!pn) return false
  return roots.some((r) => {
    const rn = normPath(r)
    if (!rn) return false
    return pn === rn || pn.startsWith(rn + '\\')
  })
}

/** True when any path segment is protected, or the name matches DENY_FILE. */
export function segmentsDenied(p) {
  return hardDenied(p) || softDenied(p)
}

/**
 * Deny decision for a canonical path, with split HARD/SOFT semantics:
 *
 *  - HARD deny (credentials, private keys, system files/dirs): NEVER
 *    escapable. A workspace registered under .ssh/.aws/Windows/AppData etc.
 *    must not make these reachable remotely.
 *  - SOFT deny (user-data privacy dirs like WeChat/WPS/AppData): denied by
 *    default, but a workspace registered EXACTLY under the protected area is
 *    reachable (the PC user deliberately registered that folder).
 *
 * @param p - canonical (realpath) path.
 * @param workspaceRoots - list of registered workspace paths (their `.path`).
 */
export function deniedPath(p, workspaceRoots) {
  const lower = normPath(p)
  if (!lower) return false
  if (hardDenied(lower)) return true
  if (!softDenied(lower)) return false
  if (Array.isArray(workspaceRoots)) {
    for (const w of workspaceRoots) {
      const wp = normPath(w)
      if (!wp) continue
      if (softDenied(wp) && (lower === wp || lower.startsWith(wp + '\\'))) return false
    }
  }
  return true
}

/** True when any HARD-deny segment (system dirs) or DENY_FILE pattern
 *  (credentials/private keys/system files) matches. Never escapable. */
export function hardDenied(p) {
  const lower = normPath(p)
  if (!lower) return false
  const segs = lower.split(/[\\/]/).filter(Boolean)
  if (segs.some((s) => HARD_DENY_SEGMENTS.has(s))) return true
  return DENY_FILE.test(String(p))
}

/** True when the path contains a SOFT-deny directory segment (user-data
 *  privacy boundary). Escapable only by a workspace registered exactly under
 *  the protected area. Hidden credential dirs (.ssh/.aws/...) are NOT here:
 *  DENY_FILE already hard-denies them. */
export function softDenied(p) {
  const lower = normPath(p)
  if (!lower) return false
  const segs = lower.split(/[\\/]/).filter(Boolean)
  return segs.some((s) => DENY_SEGMENTS.has(s))
}

/**
 * Capability rule for the allowlist: the phone may only NARROW the approved
 * roots (remove entries or add sub-paths of existing entries). Widening to an
 * unrelated location (e.g. C:\) requires editing .remfs-roots.json on the PC.
 */
export function canSetRoots(next, current) {
  if (!Array.isArray(next) || next.length === 0) return false
  return next.every((r) => isWithin(r, current))
}

/**
 * Breadcrumb segments for a path. `path` is captured eagerly per segment (no
 * shared mutable accumulator), so each crumb navigates to ITS OWN prefix.
 * Mirrored in lib/client.js (the browser module cannot import this file).
 */
export function buildCrumbs(p) {
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean)
  let acc = ''
  return segs.map((seg, i) => {
    acc = i === 0 ? seg : acc + '\\' + seg
    return { label: seg, path: acc, last: i === segs.length - 1 }
  })
}

// -------------------------------------------------------------------- auth

function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

export function randomToken(bytes) {
  return randomBytes(bytes).toString('hex')
}

/** Human-typable pairing code: 8 groups of 4 hex chars, e.g. A1B2-C3D4-... */
export function formatPairingCode(hex) {
  const groups = []
  for (let i = 0; i < hex.length; i += CODE_GROUP_CHARS) {
    groups.push(hex.slice(i, i + CODE_GROUP_CHARS))
  }
  return groups.join('-')
}

export function parsePairingCode(code) {
  return String(code || '').replace(/-/g, '').replace(/\s+/g, '').toLowerCase()
}

export const securityFile = () => path.join(os.homedir(), '.dsh', 'remfs-security.json')

export const pairingTxtFile = (file = securityFile()) =>
  path.join(path.dirname(file), 'remfs-pairing.txt')

// ------------------------------------------------------------------ store

/**
 * Load the security store. FAILS CLOSED:
 *  - ENOENT (no store yet)            -> fresh { devices: [], pairing: null }
 *  - any other read/parse/permission  -> backs the bad file up to
 *    `<file>.corrupt-<ts>` and THROWS { code: 'store-corrupt' } so callers
 *    surface an actionable error instead of silently resetting state.
 */
async function loadStore(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return { devices: [], pairing: null }
    const err = new Error('security store unreadable: ' + String((e && e.code) || e))
    err.storeCorrupt = true
    throw err
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    await backupCorrupt(file)
    const err = new Error('security store corrupt (backed up): ' + String((e && e.message) || e))
    err.storeCorrupt = true
    throw err
  }
  return {
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    pairing: parsed.pairing && typeof parsed.pairing === 'object' ? parsed.pairing : null,
  }
}

/** Copy a corrupt store aside for inspection. The original stays in place so
 *  the store keeps failing closed (never silently resets to a fresh state). */
async function backupCorrupt(file) {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await copyFile(file, file + '.corrupt-' + Date.now())
  } catch { /* best-effort */ }
}

/** Map a store-corruption failure to the canonical error result. */
function corruptResult(e) {
  return { error: ERR.STORE_CORRUPT, message: String((e && e.message) || 'security store corrupt') }
}

/** Wrap a withStoreLock body so corruption never silently resets state. */
function withStoreGuard(file, fn) {
  return withStoreLock(file, async () => {
    try {
      return await fn()
    } catch (e) {
      if (e && e.storeCorrupt) return corruptResult(e)
      throw e
    }
  })
}

/** Atomic replace: write tmp then rename (same volume => atomic on Windows). */
async function saveStore(file, store) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Serialize every store operation per file so read-modify-write cannot race. */
const locks = new Map()
function withStoreLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(file, next.then(() => {}, () => {}))
  return next
}

async function writePairingTxt(text) {
  try {
    await mkdir(path.dirname(text.file), { recursive: true })
    await writeFile(text.file, text.body, 'utf8')
  } catch { /* display is best-effort */ }
}

function consumedTxt(file, when) {
  return { file, body: `CONSUMED ${when}\n(restart the harness or run refresh_pairing.ps1 for a new code)\n` }
}

function freshTxt(file, plain, when) {
  return { file, body: plain + '\n' + when + '\n' }
}

/** True when the pairing .txt currently exposes a usable code that HASHES to
 *  the ACTIVE store.pairing.codeHash (b3dfc4b audit item 7). A non-empty,
 *  non-CONSUMED txt is NOT enough: a stale/forged .txt (left over from an
 *  earlier pairing) must not be treated as the current code. Missing or
 *  unreadable txt also means unrecoverable -> regenerate. */
async function pairingTxtUsable(file, codeHash) {
  if (!codeHash) return false
  try {
    const body = await readFile(pairingTxtFile(file), 'utf8')
    const first = String(body).split(/\r?\n/)[0] || ''
    if (!first || /^CONSUMED/.test(first)) return false
    return sha256(parsePairingCode(first)) === codeHash
  } catch {
    return false
  }
}

/** Mint a brand-new pairing code into the store and .txt (store already
 *  loaded under the lock). Returns the plaintext. */
async function writeFreshPairing(store, file, now) {
  const code = randomToken(16) // 128-bit, one-time, TTL-bounded
  const plain = formatPairingCode(code)
  store.pairing = { codeHash: sha256(code), expiresAt: now + PAIRING_TTL_MS }
  await saveStore(file, store)
  await writePairingTxt(freshTxt(pairingTxtFile(file), plain, new Date().toISOString()))
  return plain
}

/**
 * Ensure a valid, unexpired pairing code exists; regenerates when absent,
 * expired, already consumed, OR when the .txt is missing (the plaintext is
 * unrecoverable even though a codeHash remains). Returns the plaintext of the
 * fresh code, or null when the current code is still valid AND its plaintext
 * is still readable from the .txt.
 */
export async function ensurePairingCode(file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    const now = Date.now()
    if (store.pairing && store.pairing.codeHash && store.pairing.expiresAt > now &&
        await pairingTxtUsable(file, store.pairing.codeHash)) {
      return null
    }
    return writeFreshPairing(store, file, now)
  })
}

/**
 * FORCE rotation: always mints a new pairing code, even when the current code
 * is still valid. This is what refresh_pairing.ps1's host watcher must call
 * (ensurePairingCode returns null while the current code is valid, so a manual
 * refresh would otherwise do nothing). Returns the fresh plaintext.
 */
export async function rotatePairingCode(file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    return writeFreshPairing(store, file, Date.now())
  })
}

/** Read-only pairing status (for PC-side UI/scripts). */
export async function pairingStatus(file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    if (!store.pairing || !store.pairing.codeHash) return { present: false }
    return { present: true, expiresAt: store.pairing.expiresAt, expired: store.pairing.expiresAt < Date.now() }
  })
}

/**
 * Consume a pairing code: strictly single-use + expiry, under the store lock.
 * On success creates a device and returns { deviceId, credential }; the
 * consumed code is marked in the .txt so it cannot mislead the user.
 */
export async function pairDevice(code, deviceName, file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    const p = store.pairing
    if (!p || !p.codeHash) return { error: ERR.PAIRING_USED }
    if (p.expiresAt < Date.now()) return { error: ERR.PAIRING_EXPIRED }
    const given = sha256(parsePairingCode(code))
    if (given !== p.codeHash) return { error: ERR.PAIRING_INVALID }
    // single use
    store.pairing = null
    const deviceId = randomUUID()
    const credential = randomToken(CREDENTIAL_BYTES)
    store.devices.push({
      id: deviceId,
      name: String(deviceName || 'phone').slice(0, 60),
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      credentialHash: sha256(credential),
      // Capability model: every newly paired device gets the default set
      // (files + approval). Existing devices without the field migrate to
      // the same default.
      capabilities: DEFAULT_DEVICE_CAPABILITIES.slice(),
    })
    await saveStore(file, store)
    await writePairingTxt(consumedTxt(pairingTxtFile(file), new Date().toISOString()))
    return { deviceId, credential }
  })
}

/** Verify a device credential; updates lastSeen on success (under the lock).
 *  The returned device carries `capabilities` (default for legacy devices). */
export async function verifyDevice(deviceId, credential, file = securityFile()) {
  if (typeof deviceId !== 'string' || typeof credential !== 'string' || !deviceId || !credential) {
    return { error: ERR.AUTH_REQUIRED }
  }
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    const dev = store.devices.find((d) => d.id === deviceId)
    if (!dev) return { error: ERR.AUTH_INVALID }
    if (sha256(credential) !== dev.credentialHash) return { error: ERR.AUTH_INVALID }
    dev.lastSeen = new Date().toISOString()
    await saveStore(file, store)
    // legacy devices (no capabilities field) surface the default set
    const caps = Array.isArray(dev.capabilities) && dev.capabilities.length > 0
      ? dev.capabilities
      : DEFAULT_DEVICE_CAPABILITIES
    return { ok: true, device: { ...dev, capabilities: caps.slice() } }
  })
}

/** True when a verified device has `cap` (defaults for legacy devices). */
export function deviceHasCapability(device, cap) {
  const caps = device && device.capabilities
  return Array.isArray(caps) && caps.includes(cap)
}

export async function listDevices(file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    return store.devices.map((d) => ({
      id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen,
    }))
  })
}

export async function revokeDevice(deviceId, file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    const before = store.devices.length
    store.devices = store.devices.filter((d) => d.id !== deviceId)
    if (store.devices.length === before) return { error: ERR.DEVICE_NOT_FOUND }
    await saveStore(file, store)
    return { ok: true }
  })
}

export async function revokeAllDevices(file = securityFile()) {
  return withStoreGuard(file, async () => {
    const store = await loadStore(file)
    store.devices = []
    store.pairing = null
    await saveStore(file, store)
    // b3dfc4b audit item 7: pairing was cleared, so invalidate the .txt - a
    // stale code must not keep looking usable after a revoke-all.
    await writePairingTxt(consumedTxt(pairingTxtFile(file), new Date().toISOString()))
    return { ok: true }
  })
}

// ----------------------------------------------------------------- options
// Optional operator switches live in ~/.dsh/remfs-options.json (same directory
// as remfs-security.json, never in the repo). Unknown/missing/corrupt values
// fail closed to the DEFAULT (off). The host reads this once at apply time.
export function optionsFile() {
  return path.join(os.homedir(), '.dsh', 'remfs-options.json')
}

/**
 * Read the operator options.
 * @param {string} [file] - options file path (defaults to optionsFile()).
 * @returns {{ pocketStrict: boolean, push: { done: boolean, intervalSeconds: number } }}
 *   - pocketStrict: when true, /pocket STATUS/TASKS also require a valid device
 *     credential (default: false).
 *   - push.done: when true, DONE transitions also produce a Web Push
 *     notification (NEEDS_USER/FAILED always do; default: false).
 *   - push.intervalSeconds: dispatcher poll interval (clamped 5..60, default 10).
 */
export function readRemfsOptions(file = optionsFile()) {
  let obj = null
  try {
    obj = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { pocketStrict: false, push: { done: false, intervalSeconds: 10 } }
  }
  const pushRaw = (obj && obj.push) || {}
  const push = {
    done: !!(pushRaw && pushRaw.done),
    intervalSeconds: Number(pushRaw && pushRaw.intervalSeconds) > 0 ? Number(pushRaw.intervalSeconds) : 10,
  }
  return { pocketStrict: !!(obj && obj.pocketStrict), push }
}
