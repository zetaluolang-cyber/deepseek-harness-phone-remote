// Persistent host half: exposes the /remfs RPC channel (trusted-host authority)
// with device authentication, pairing, workspace and file operations.
// All protocol logic lives in ./dispatch.js (unit-testable); this file only
// adapts the Cordis runtime (ctx.fs / workspaceRegistry) to it.
//
// inject is REQUIRED: the loader resolves cross-entry services before apply
// runs. sandboxPolicy/workspaceRegistry are declared explicitly because the
// safe workspace-root resolution depends on them at apply time - relying on
// accidental plugin ordering would make the fail-closed root resolution
// nondeterministic.
import { ensurePairingCode, rotatePairingCode, verifyDevice, deviceHasCapability } from './security.js'
import { createDispatcher } from './dispatch.js'
import { createCockpitService } from './cockpit/service.js'
import { POCKET_OPS, CAPABILITIES } from './cockpit/contract.js'
import { access, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export default {
  inject: ['connection', 'fs', 'sandboxPolicy', 'workspaceRegistry'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) {
      console.log('[remfs-persistent] host apply skipped: fs unavailable')
      return
    }
    const conn = ctx.get('connection')
    if (conn === undefined || !conn.rpc) {
      console.log('[remfs-persistent] host apply skipped: connection.rpc unavailable')
      return
    }

    // Resolve the workspace root ONCE at apply time. This is a security
    // decision: we NEVER fall back to a whole drive (e.g. C:\). If neither the
    // sandbox policy nor the workspace registry can provide a safe root, the
    // plugin fails closed and the /remfs channel is NOT registered.
    const workspaceRoot = () => {
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) return sp.workspaceRoot
      const wr = ctx.get('workspaceRegistry')
      if (wr && typeof wr.list === 'function') {
        const list = wr.list()
        if (list && list.length > 0 && list[0] && list[0].path) return list[0].path
      }
      throw new Error('no safe workspace root (sandboxPolicy/workspaceRegistry unavailable)')
    }

    let resolvedRoot = null
    try {
      resolvedRoot = workspaceRoot()
    } catch (e) {
      console.log('[remfs-persistent] host apply skipped (fail closed): ' + String((e && e.message) || e))
      return
    }
    if (typeof resolvedRoot !== 'string' || !resolvedRoot) {
      console.log('[remfs-persistent] host apply skipped (fail closed): empty workspace root')
      return
    }

    // resolvedRoot is the ONLY root used after apply; adapter methods must
    // never re-resolve via ctx (the registry could change mid-flight).
    const root = resolvedRoot

    const adapter = {
      workspaceRoot: () => root,
      policy: () => {
        const sp = ctx.get('sandboxPolicy')
        if (sp && typeof sp.resolve === 'function') {
          try { return sp.resolve() } catch { /* ignore */ }
        }
        return undefined
      },
      readAllowedFile: async () => {
        try {
          const target = await fs.resolve(root + '\\.remfs-roots.json', { cwd: root })
          const text = await fs.readText(target)
          return { exists: true, text }
        } catch (e) {
          // Only a genuinely missing file is the "not configured" default.
          // Anything else (permission, EISDIR, I/O) must fail closed.
          const code = String((e && e.code) || (e && e.message) || e)
          if (/ENOENT|not found/i.test(code)) return { exists: false }
          return { error: code }
        }
      },
      writeAllowedFile: async (roots) => {
        const target = await fs.resolve(root + '\\.remfs-roots.json', { cwd: root })
        await fs.writeText(target, JSON.stringify(roots, null, 2), undefined, undefined, adapter.policy())
      },
      resolvePath: async (p) => ({ target: await fs.resolve(p, { cwd: root }) }),
      processPath: (t) => fs.processPath(t),
      stat: (t) => fs.stat(t),
      listDir: (t) => fs.listDir(t),
      readText: (t) => fs.readText(t),
      readBytes: (t, max) => fs.readBytes(t, undefined, max),
      writeText: (t, content, pol) => fs.writeText(t, content, undefined, undefined, pol),
      listWorkspaces: async () => {
        const wr = ctx.get('workspaceRegistry')
        if (!wr || typeof wr.list !== 'function') return []
        try { return wr.list() } catch { return [] }
      },
      resolveWorkspaceByPath: async (p) => {
        const wr = ctx.get('workspaceRegistry')
        if (!wr || typeof wr.resolveByPath !== 'function') return undefined
        try { return wr.resolveByPath(p) } catch { return undefined }
      },
      createWorkspace: async (p) => {
        const wr = ctx.get('workspaceRegistry')
        if (!wr || typeof wr.create !== 'function') throw new Error('workspace registry unavailable')
        return wr.create(p)
      },
    }

    const handler = createDispatcher(adapter)

    conn.rpc.handle('/remfs', handler, { authority: 'trusted-host' })

    // ── Pocket Cockpit (/pocket) — human supervision capability (v0.3 Phase 1)
    // Separate namespace from /remfs: filesystem capability vs supervision
    // capability have different permission semantics. Every /pocket operation
    // requires a VALID device credential AND the 'cockpit' device capability;
    // a legacy device (no capabilities field) gets the default set which
    // includes cockpit. Fail closed: no device -> no cockpit.
    const cockpit = createCockpitService(ctx)
    const pocketErr = (code, message) => ({ ok: false, error: { code, message, details: {} } })

    const pocketHandler = async (endpoint, payload) => {
      const authRes = await verifyDevice(
        payload && payload.deviceId,
        payload && payload.credential,
      )
      if (authRes.error === 'store-corrupt') {
        return pocketErr('store-corrupt', 'security store corrupt — see ~/.dsh/remfs-security.json.corrupt-*')
      }
      if (authRes.error) return pocketErr('auth-invalid', 'device authentication failed — re-pair the device')
      if (!deviceHasCapability(authRes.device, CAPABILITIES.COCKPIT)) {
        return pocketErr('capability-denied', 'device lacks the cockpit capability')
      }
      switch (endpoint) {
        case POCKET_OPS.STATUS: return cockpit.status(authRes.device)
        case POCKET_OPS.SESSIONS: return cockpit.sessions()
        case POCKET_OPS.AWAY_START: return cockpit.awayStart()
        case POCKET_OPS.AWAY_STOP: return cockpit.awayStop()
        default: return pocketErr('bad-request', 'unknown /pocket endpoint: ' + String(endpoint))
      }
    }

    conn.rpc.handle('/pocket', pocketHandler, { authority: 'trusted-host' })

    // Generate/refresh the pairing code and surface it PC-side. The code
    // regenerates at every startup when the previous one was used or expired,
    // so there is always a clear path to a fresh code.
    ensurePairingCode().then((plain) => {
      if (plain) console.log('[remfs-persistent] pairing code: ' + plain + ' (see ~/.dsh/remfs-pairing.txt)')
      else console.log('[remfs-persistent] pairing code unchanged (see ~/.dsh/remfs-pairing.txt)')
    }).catch((e) => {
      console.log('[remfs-persistent] pairing code unavailable: ' + String(e))
    })

    // Pairing-rotation control: refresh_pairing.ps1 must NOT mutate the store
    // (single-writer: only THIS host process writes remfs-security.json). It
    // drops a flag file and we rotate here, under our own store lock.
    // rotatePairingCode() FORCES a new code - ensurePairingCode() would return
    // null while the current code is still valid and the manual refresh would
    // silently do nothing.
    ctx.effect(() => {
      const flag = path.join(os.homedir(), '.dsh', 'remfs-pairing-rotate.flag')
      const poll = async () => {
        try {
          await access(flag)
        } catch { return }
        try { await unlink(flag) } catch { /* ignore */ }
        try {
          const plain = await rotatePairingCode()
          console.log('[remfs-persistent] pairing code rotated: ' + plain + ' (see ~/.dsh/remfs-pairing.txt)')
        } catch (e) {
          console.log('[remfs-persistent] pairing rotation failed: ' + String((e && e.message) || e))
        }
      }
      const handle = setInterval(poll, 8000)
      return () => { try { clearInterval(handle) } catch { /* ignore */ } }
    }, 'remfs pairing rotation watcher')

    console.log('[remfs-persistent] host applied: /remfs + /pocket channels registered')
  }
}
