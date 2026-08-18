// dispatch.js — the /remfs endpoint dispatcher, parameterized over an adapter
// so the exact protocol (auth gate, envelope, capability checks) is unit-testable
// with a temp-directory filesystem. host.js wires the real Cordis adapter in.
//
// Result envelope (Connection RPC contract):
//   ok    -> { ok: true, value }
//   error -> { ok: false, error: { code, message, details } }
//
// Adapter contract:
//   workspaceRoot()                 -> string
//   policy()                        -> sandbox policy for writes (or undefined)
//   readAllowedFile()               -> Promise<{ exists: boolean, text?: string }>
//   writeAllowedFile(roots)         -> Promise<void>
//   resolvePath(p)                  -> Promise<{ target }>           (fs.resolve)
//   processPath(target)             -> string                        (canonical/realpath)
//   stat(target)                    -> Promise<{ type, size } | undefined>
//   listDir(target)                 -> Promise<[{ name, type, size? }]>
//   readText(target)                -> Promise<string>
//   readBytes(target, max)          -> Promise<Uint8Array>
//   writeText(target, content, pol) -> Promise<void>
//   listWorkspaces()                -> Promise<[{ id, path, title }]>
//   resolveWorkspaceByPath(path)    -> Promise<{ id } | undefined>
//   createWorkspace(path)           -> Promise<{ id }>
import {
  hasTraversal, isWithin, deniedPath, canSetRoots,
  pairDevice, verifyDevice, listDevices, revokeDevice,
  revokeAllDevices, securityFile as defaultSecurityFile, ERR,
} from './security.js'
import {
  hasUtf16Bom, hasUtf8Bom, isValidUtf8, dominantNewline,
  applyNewlineStyle, withBom,
} from './encoding.js'

const MAX_BINARY = 5 * 1024 * 1024
// Byte prefix probed on write to detect the original file's encoding, BOM and
// newline style. BOMs live in the first bytes and a 64 KB prefix is a fair
// sample of the dominant newline style without reading huge logs.
const ENCODE_PROBE_BYTES = 64 * 1024

const err = (code, message, details) => ({ ok: false, error: { code, message, details: details || {} } })

async function resolveRoots(adapter) {
  let info
  try {
    info = await adapter.readAllowedFile()
  } catch {
    return { roots: [], error: 'allowlist unreadable' } // fail-closed
  }
  if (info && info.error) {
    return { roots: [], error: 'allowlist unreadable' } // fail-closed
  }
  if (!info.exists) return { roots: [adapter.workspaceRoot()], error: null }
  let parsed
  try {
    parsed = JSON.parse(info.text || '')
  } catch {
    return { roots: [], error: 'allowlist corrupt' } // fail-closed
  }
  if (!Array.isArray(parsed)) return { roots: [], error: 'allowlist corrupt' } // fail-closed
  const list = parsed.map(String).filter(Boolean)
  if (list.length === 0) return { roots: [], error: 'allowlist empty' } // fail-closed
  return { roots: list, error: null }
}

function guardRawPath(p) {
  if (hasTraversal(p)) return err(ERR.PATH_TRAVERSAL, 'path traversal is not allowed')
  return null
}

function parentOf(p) {
  if (!p) return null
  const n = p.replace(/[\\/]+$/, '')
  const m = n.match(/^([A-Za-z]:)(.*)$/)
  if (!m) return null
  const drive = m[1]
  const rest = m[2]
  if (!rest) return null
  const idx = rest.lastIndexOf('\\')
  if (idx <= 0) return drive + '\\'
  return drive + rest.slice(0, idx)
}

function base64Of(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/**
 * Create the /remfs handler.
 * @param adapter - filesystem/workspace adapter (see contract above).
 * @param opts - { securityFile } for the auth store (defaults to ~/.dsh).
 */
export function createDispatcher(adapter, opts = {}) {
  const secFile = opts.securityFile || defaultSecurityFile()

  const auth = async (payload) => {
    const res = await verifyDevice(payload && payload.deviceId, payload && payload.credential, secFile)
    if (res.error === ERR.STORE_CORRUPT) {
      return err(ERR.STORE_CORRUPT, 'security store corrupt — see ~/.dsh/remfs-security.json.corrupt-*; re-pair devices after fixing it')
    }
    if (res.error === ERR.AUTH_REQUIRED) return err(ERR.AUTH_REQUIRED, 'device authentication required')
    if (res.error) return err(ERR.AUTH_INVALID, 'device authentication failed — re-pair the device')
    return null
  }

  const workspaceRoots = async () => {
    try {
      const list = await adapter.listWorkspaces()
      return (list || []).map((w) => String(w.path || '')).filter(Boolean)
    } catch { return [] }
  }

  return async function handler(endpoint, payload) {
    try {
      // ---- unauthenticated bootstrap: pairing ----
      if (endpoint === 'pair') {
        const code = payload && payload.code
        const name = payload && payload.deviceName
        if (!code || typeof code !== 'string') return err(ERR.PAIRING_INVALID, 'pairing code required')
        const res = await pairDevice(code, name, secFile)
        if (res.error === ERR.STORE_CORRUPT) {
          return err(ERR.STORE_CORRUPT, 'security store corrupt — see ~/.dsh/remfs-security.json.corrupt-*')
        }
        if (res.error === ERR.PAIRING_EXPIRED) {
          return err(ERR.PAIRING_EXPIRED, 'pairing code expired — run refresh_pairing.ps1 (or restart the harness) for a new code')
        }
        if (res.error === ERR.PAIRING_USED) {
          return err(ERR.PAIRING_USED, 'pairing code already used — run refresh_pairing.ps1 (or restart the harness) for a new code')
        }
        if (res.error) return err(ERR.PAIRING_INVALID, 'invalid pairing code')
        return { ok: true, value: { deviceId: res.deviceId, credential: res.credential } }
      }

      // ---- everything else requires a valid device credential ----
      const authErr = await auth(payload)
      if (authErr) return authErr

      switch (endpoint) {
        case 'devices': {
          const devices = await listDevices(secFile)
          return { ok: true, value: { devices } }
        }
        case 'revoke': {
          // Protocol: the caller authenticates with its OWN deviceId/credential;
          // the target to revoke comes in a separate field so A can revoke B.
          const target = payload && payload.targetDeviceId
          if (typeof target !== 'string' || !target) return err('bad-request', 'targetDeviceId required', { issues: [] })
          const res = await revokeDevice(target, secFile)
          if (res.error) return err(ERR.DEVICE_NOT_FOUND, 'device not found')
          return { ok: true, value: {} }
        }
        case 'revokeAll': {
          await revokeAllDevices(secFile)
          return { ok: true, value: {} }
        }
        case 'allowed': {
          const r = await resolveRoots(adapter)
          return { ok: true, value: { allowed: r.roots, root: adapter.workspaceRoot() } }
        }
        case 'setAllowed': {
          const roots = payload && Array.isArray(payload.roots) ? payload.roots.map(String).filter(Boolean) : []
          if (roots.length === 0) return err('bad-request', 'no roots provided', { issues: [] })
          const cur = await resolveRoots(adapter)
          if (cur.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          if (!canSetRoots(roots, cur.roots)) {
            return err(ERR.ROOT_OUTSIDE, 'new roots must stay inside approved roots — edit .remfs-roots.json on the PC to add new locations')
          }
          await adapter.writeAllowedFile(roots)
          return { ok: true, value: { allowed: roots } }
        }
        case 'workspaces': {
          // b3dfc4b audit item 6 (option A): expose ONLY workspaces inside the
          // remfs capability boundary. Native DSH workspace authority is
          // outside remfs authorization, so a workspace outside the allowed
          // roots or under a protected path must never be listed here.
          const r = await resolveRoots(adapter)
          if (r.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          const wps = await workspaceRoots()
          const list = (await adapter.listWorkspaces()) || []
          const allowed = list.filter((w) => {
            const p = String(w && w.path || '')
            if (!p) return false
            if (deniedPath(p, wps)) return false
            return isWithin(p, r.roots)
          })
          return { ok: true, value: { workspaces: allowed.map((w) => ({ id: String(w.id), path: String(w.path || ''), title: String(w.title || w.path || '') })) } }
        }
        case 'ensureWorkspace': {
          const raw = payload && payload.path
          if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
          const g = guardRawPath(raw)
          if (g) return g
          const { target } = await adapter.resolvePath(raw)
          const canonical = adapter.processPath(target)
          const r = await resolveRoots(adapter)
          if (r.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          const wps = await workspaceRoots()
          if (deniedPath(canonical, wps)) return err(ERR.PATH_PROTECTED, 'path is protected')
          if (!isWithin(canonical, r.roots)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
          const existing = await adapter.resolveWorkspaceByPath(canonical)
          if (existing) return { ok: true, value: { workspaceId: String(existing.id), created: false } }
          const created = await adapter.createWorkspace(canonical)
          return { ok: true, value: { workspaceId: String(created.id), created: true } }
        }
        case 'list': {
          const raw = payload && typeof payload.path === 'string' && payload.path ? payload.path : ''
          if (raw) {
            const g = guardRawPath(raw)
            if (g) return g
          }
          const { target } = await adapter.resolvePath(raw || adapter.workspaceRoot())
          const info = await adapter.stat(target)
          if (!info) return err('internal', 'path not found: ' + (raw || adapter.workspaceRoot()), {})
          if (info.type !== 'directory') return err('internal', 'not a directory: ' + raw, {})
          const r = await resolveRoots(adapter)
          if (r.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          const canonical = adapter.processPath(target)
          const wps = await workspaceRoots()
          if (deniedPath(canonical, wps)) return err(ERR.PATH_PROTECTED, 'path is protected')
          if (!isWithin(canonical, r.roots)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
          // b3dfc4b audit item 5: filter EVERY child through the capability
          // boundary BEFORE its name/metadata leaves /remfs. Hard-denied
          // children (.ssh, .aws, .env, private keys, system dirs) and
          // children outside the allowed roots must never appear in listings,
          // even when the parent directory itself is allowed.
          const childJoin = (name) => canonical.replace(/[\\/]+$/, '') + '\\' + name
          const entries = (await adapter.listDir(target)).filter((e) => {
            const child = childJoin(String(e && e.name || ''))
            if (deniedPath(child, wps)) return false
            return isWithin(child, r.roots)
          })
          let parent = parentOf(canonical)
          if (parent && (deniedPath(parent, wps) || !isWithin(parent, r.roots))) parent = null
          return { ok: true, value: { path: canonical, parent, entries } }
        }
        case 'read': {
          const raw = payload && payload.path
          if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
          const g = guardRawPath(raw)
          if (g) return g
          const { target } = await adapter.resolvePath(raw)
          const info = await adapter.stat(target)
          if (!info) return err('internal', 'not found: ' + raw, {})
          if (info.type !== 'file') return err('internal', 'not a file: ' + raw, {})
          const r = await resolveRoots(adapter)
          if (r.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          const canonical = adapter.processPath(target)
          const wps = await workspaceRoots()
          if (deniedPath(canonical, wps)) return err(ERR.PATH_PROTECTED, 'path is protected')
          if (!isWithin(canonical, r.roots)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
          if (typeof info.size === 'number' && info.size > MAX_BINARY) {
            return { ok: true, value: { kind: 'too-large', size: info.size } }
          }
          try {
            const text = await adapter.readText(target)
            return { ok: true, value: { kind: 'text', text, size: typeof info.size === 'number' ? info.size : text.length } }
          } catch {
            const bytes = await adapter.readBytes(target, MAX_BINARY)
            return { ok: true, value: { kind: 'base64', base64: base64Of(bytes), size: bytes.length } }
          }
        }
        case 'write': {
          const raw = payload && payload.path
          const content = payload && typeof payload.content === 'string' ? payload.content : null
          if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
          if (content === null) return err('bad-request', 'missing content', { issues: [] })
          const g = guardRawPath(raw)
          if (g) return g
          const { target } = await adapter.resolvePath(raw)
          const r = await resolveRoots(adapter)
          if (r.error) return err(ERR.PATH_OUTSIDE, 'allowlist unavailable — fix .remfs-roots.json on the PC')
          const canonical = adapter.processPath(target)
          const wps = await workspaceRoots()
          if (deniedPath(canonical, wps)) return err(ERR.PATH_PROTECTED, 'path is protected')
          if (!isWithin(canonical, r.roots)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
          // Data-integrity guard: never overwrite a file that is not UTF-8
          // (UTF-16 BOM, or invalid UTF-8 sequences that indicate GBK/ANSI
          // content) - the edit would corrupt it. A missing file (new upload)
          // has nothing to guard. Existing UTF-8 BOM and the dominant newline
          // style (CRLF/LF) are preserved on write-back.
          let before = null
          try {
            before = await adapter.readBytes(target, ENCODE_PROBE_BYTES)
          } catch { /* new file */ }
          if (before && before.length > 0) {
            if (hasUtf16Bom(before) || !isValidUtf8(before)) {
              return err(ERR.ENCODING_NOT_UTF8, 'file is not UTF-8 - convert to UTF-8 and retry')
            }
          }
          const nl = before ? dominantNewline(before) : null
          const bom = before ? hasUtf8Bom(before) : false
          const out = applyNewlineStyle(withBom(content, bom), nl)
          await adapter.writeText(target, out, adapter.policy())
          return { ok: true, value: { path: canonical } }
        }
        default:
          return err('bad-request', 'unknown endpoint: ' + String(endpoint), { issues: [] })
      }
    } catch (e) {
      return err('internal', String((e && e.message) || e), {})
    }
  }
}
