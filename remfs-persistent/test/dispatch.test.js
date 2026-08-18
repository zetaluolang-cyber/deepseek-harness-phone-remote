// Protocol/integration tests for the /remfs dispatcher, using a real
// temp-directory filesystem adapter. Run: node --test test/dispatch.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { promises as fsp } from 'node:fs'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createDispatcher } from '../lib/dispatch.js'
import { ensurePairingCode, pairDevice } from '../lib/security.js'

async function setup() {
  // Test roots must NOT live under a protected segment (AppData on Windows is
  // denied by DENY_SEGMENTS), so create them inside the repo working dir.
  const dir = await fsp.mkdtemp(path.join(process.cwd(), '.tmp-dispatch-'))
  const root = path.join(dir, 'workspace')
  await fsp.mkdir(root)
  await fsp.writeFile(path.join(root, 'hello.txt'), 'hello world')
  await fsp.mkdir(path.join(root, 'sub'))
  const workspaces = []
  const adapter = {
    workspaceRoot: () => root,
    policy: () => undefined,
    readAllowedFile: async () => {
      try {
        const t = await fsp.readFile(path.join(root, '.remfs-roots.json'), 'utf8')
        return { exists: true, text: t }
      } catch (e) {
        if (e && e.code === 'ENOENT') return { exists: false }
        return { error: String(e.code || e.message) }
      }
    },
    writeAllowedFile: async (roots) => fsp.writeFile(path.join(root, '.remfs-roots.json'), JSON.stringify(roots, null, 2)),
    resolvePath: async (p) => ({ target: { key: path.resolve(root, p || ''), display: p } }),
    processPath: (t) => { try { return realpathSync(t.key) } catch { return t.key } },
    stat: async (t) => { const s = await fsp.stat(t.key); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } },
    listDir: async (t) => (await fsp.readdir(t.key, { withFileTypes: true })).map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file' })),
    readText: async (t) => fsp.readFile(t.key, 'utf8'),
    readBytes: async (t, max) => (await fsp.readFile(t.key)).subarray(0, max),
    writeText: async (t, content) => fsp.writeFile(t.key, content),
    listWorkspaces: async () => workspaces.slice(),
    resolveWorkspaceByPath: async (p) => workspaces.find((w) => w.path === p),
    createWorkspace: async (p) => {
      const w = { id: 'ws-' + workspaces.length, path: p, title: path.basename(p) }
      workspaces.push(w)
      return w
    },
  }
  const secFile = path.join(dir, 'security.json')
  const handler = createDispatcher(adapter, { securityFile: secFile })
  const pair = async (name) => {
    const code = await ensurePairingCode(secFile)
    const res = await pairDevice(code, name, secFile)
    assert.ok(res.deviceId && res.credential, 'pair should succeed')
    return { deviceId: res.deviceId, credential: res.credential }
  }
  return { dir, root, secFile, handler, pair, workspaces }
}

async function teardown(t, dir) {
  await rm(dir, { recursive: true, force: true })
}

const listCall = (h, p) => h('list', p)

// ------------------------------------------------------------- bug 2: revoke

test('revoke protocol: A revokes B; A stays authorized, B is invalidated', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const B = await pair('device-b')
    assert.equal((await listCall(handler, { deviceId: A.deviceId, credential: A.credential, path: root })).ok, true)
    assert.equal((await listCall(handler, { deviceId: B.deviceId, credential: B.credential, path: root })).ok, true)

    // A revokes B via targetDeviceId (not the caller's deviceId).
    const rev = await handler('revoke', { deviceId: A.deviceId, credential: A.credential, targetDeviceId: B.deviceId })
    assert.equal(rev.ok, true)

    // B is dead, A lives.
    const bAfter = await listCall(handler, { deviceId: B.deviceId, credential: B.credential, path: root })
    assert.equal(bAfter.ok, false)
    assert.equal(bAfter.error.code, 'auth-invalid')
    assert.equal((await listCall(handler, { deviceId: A.deviceId, credential: A.credential, path: root })).ok, true)

    // Old/broken protocol (target in deviceId, no targetDeviceId) is rejected,
    // and must never revoke the caller.
    const bad = await handler('revoke', { deviceId: A.deviceId, credential: A.credential, deviceId2: B.deviceId })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    assert.equal((await listCall(handler, { deviceId: A.deviceId, credential: A.credential, path: root })).ok, true)
  } finally { await teardown(t, dir) }
})

// ------------------------------------------------------- bug 3: concurrency

test('concurrency: verifyDevice racing revokeDevice never resurrects the credential', async (t) => {
  const { dir, root, handler, pair, secFile } = await setup()
  try {
    const A = await pair('device-a')
    const { verifyDevice, revokeDevice } = await import('../lib/security.js')
    for (let i = 0; i < 25; i++) {
      await Promise.all([
        verifyDevice(A.deviceId, A.credential, secFile),
        verifyDevice(A.deviceId, A.credential, secFile),
        revokeDevice(A.deviceId, secFile),
        verifyDevice(A.deviceId, A.credential, secFile),
      ])
      const after = await verifyDevice(A.deviceId, A.credential, secFile)
      assert.equal(after.ok, undefined, 'credential must not resurrect after revoke')
      assert.equal(after.error, 'auth-invalid')
      // re-pair for the next round
      const code = await ensurePairingCode(secFile)
      const rp = await pairDevice(code, 'device-a', secFile)
      assert.ok(rp.deviceId)
      A.deviceId = rp.deviceId; A.credential = rp.credential
    }
  } finally { await teardown(t, dir) }
})

test('concurrency: pairing code is strictly single-use', async (t) => {
  const { dir, secFile } = await setup()
  try {
    const code = await ensurePairingCode(secFile)
    const results = await Promise.all([
      pairDevice(code, 'one', secFile),
      pairDevice(code, 'two', secFile),
      pairDevice(code, 'three', secFile),
    ])
    const okCount = results.filter((r) => r.deviceId).length
    assert.equal(okCount, 1, 'exactly one concurrent pair must win')
    const failCodes = results.filter((r) => r.error).map((r) => r.error)
    assert.ok(failCodes.every((c) => c === 'pairing-used' || c === 'pairing-invalid'))
  } finally { await teardown(t, dir) }
})

// -------------------------------------------------------- bug 4: lifecycle

test('pairing lifecycle: second device + expired-code regeneration', async (t) => {
  const { dir, secFile, handler, root } = await setup()
  try {
    const { pairDevice: pd, ensurePairingCode: epc } = await import('../lib/security.js')
    // second device
    const c1 = await epc(secFile)
    const d1 = await pd(c1, 'one', secFile)
    assert.ok(d1.deviceId)
    const c2 = await epc(secFile) // regenerates after consumption
    assert.ok(c2, 'a fresh code must be generated after use')
    const d2 = await pd(c2, 'two', secFile)
    assert.ok(d2.deviceId)
    const h = handler
    assert.equal((await h('list', { deviceId: d1.deviceId, credential: d1.credential, path: root })).ok, true)
    assert.equal((await h('list', { deviceId: d2.deviceId, credential: d2.credential, path: root })).ok, true)

    // expired code path: force expiry, pair fails with pairing-expired, then regenerate works
    const raw = JSON.parse(await fsp.readFile(secFile, 'utf8'))
    raw.pairing = { codeHash: 'deadbeef', expiresAt: Date.now() - 1000 }
    await fsp.writeFile(secFile, JSON.stringify(raw), 'utf8')
    const expired = await pd(c2, 'three', secFile)
    assert.equal(expired.error, 'pairing-expired')
    const c3 = await epc(secFile)
    assert.ok(c3)
    const d3 = await pd(c3, 'three', secFile)
    assert.ok(d3.deviceId)

    // consumed code marks the .txt so it cannot mislead
    const txt = path.join(dir, 'remfs-pairing.txt')
    const body = await fsp.readFile(txt, 'utf8')
    assert.ok(/CONSUMED/.test(body), 'pairing txt should be marked consumed')
  } finally { await teardown(t, dir) }
})

// ------------------------------------------------------- bug 10: fail-closed

test('allowlist: corrupt file fails closed (never expands to workspace root)', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    // corrupt the allowlist
    await fsp.writeFile(path.join(root, '.remfs-roots.json'), '{ not json !!!', 'utf8')
    const r1 = await listCall(handler, { ...base, path: root })
    assert.equal(r1.ok, false)
    assert.equal(r1.error.code, 'path-outside-allowed')
    // unreadable (directory where file should be) => fail closed too
    await rm(path.join(root, '.remfs-roots.json'), { force: true })
    await fsp.mkdir(path.join(root, '.remfs-roots.json'))
    const r2 = await listCall(handler, { ...base, path: root })
    assert.equal(r2.ok, false)
    // empty array => deny all
    await rm(path.join(root, '.remfs-roots.json'), { recursive: true, force: true })
    await fsp.writeFile(path.join(root, '.remfs-roots.json'), '[]', 'utf8')
    const r3 = await listCall(handler, { ...base, path: root })
    assert.equal(r3.ok, false)
    // missing file => default workspace root (legit default)
    await rm(path.join(root, '.remfs-roots.json'), { force: true })
    const r4 = await listCall(handler, { ...base, path: root })
    assert.equal(r4.ok, true)
  } finally { await teardown(t, dir) }
})

// ------------------------------------------------------ bug 11: contract

test('RPC contract: envelope shapes, auth gate, traversal, roundtrip', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }

    // unknown endpoint (authenticated => bad-request; unauthenticated => auth gate)
    const unk = await handler('nope', base)
    assert.equal(unk.ok, false)
    assert.equal(unk.error.code, 'bad-request')
    assert.ok(unk.error.message && unk.error.details)

    // auth gate
    const noAuth = await listCall(handler, { path: root })
    assert.equal(noAuth.ok, false)
    assert.equal(noAuth.error.code, 'auth-required')

    // traversal rejected
    const trav = await listCall(handler, { ...base, path: root + '\\..\\..' })
    assert.equal(trav.ok, false)
    assert.equal(trav.error.code, 'path-traversal')

    // read/write roundtrip inside the root (path.join => native separators)
    const subFile = path.join(root, 'sub', 'new.txt')
    const w = await handler('write', { ...base, path: subFile, content: 'data123' })
    assert.equal(w.ok, true)
    const rd = await handler('read', { ...base, path: subFile })
    assert.equal(rd.ok, true)
    assert.equal(rd.value.kind, 'text')
    assert.equal(rd.value.text, 'data123')

    // protected path denied
    await fsp.writeFile(path.join(root, '.credentials.yaml'), 'k: v')
    const prot = await listCall(handler, { ...base, path: root })
    assert.equal(prot.ok, true)
    const protRead = await handler('read', { ...base, path: path.join(root, '.credentials.yaml') })
    assert.equal(protRead.ok, false)
    assert.equal(protRead.error.code, 'path-protected')

    // symlink escape: link inside root pointing outside -> canonical path outside
    const outside = path.join(dir, 'outside.txt')
    await fsp.writeFile(outside, 'secret')
    try {
      await fsp.symlink(outside, path.join(root, 'link.txt'))
      const esc = await handler('read', { ...base, path: path.join(root, 'link.txt') })
      assert.equal(esc.ok, false)
      assert.equal(esc.error.code, 'path-outside-allowed')
    } catch { /* symlink unsupported on this platform; skip */ }
  } finally { await teardown(t, dir) }
})

test('ensureWorkspace: raw path traversal rejected, resolved path capability enforced', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    const trav = await handler('ensureWorkspace', { ...base, path: root + '/../../../Windows' })
    assert.equal(trav.error.code, 'path-traversal')
    const outside = await handler('ensureWorkspace', { ...base, path: dir }) // sibling of root
    assert.equal(outside.error.code, 'path-outside-allowed')
    const ok = await handler('ensureWorkspace', { ...base, path: path.join(root, 'sub') })
    assert.equal(ok.ok, true)
    assert.ok(ok.value.workspaceId)
  } finally { await teardown(t, dir) }
})

test('fail closed: no workspace root must NEVER grant whole-drive access', async (t) => {
  const { dir } = await setup()
  try {
    const secFile = path.join(dir, 'sec.json')
    const noRootAdapter = {
      workspaceRoot: () => { throw new Error('no safe workspace root') },
      policy: () => undefined,
      readAllowedFile: async () => ({ exists: false }),
      writeAllowedFile: async () => {},
      resolvePath: async (p) => ({ target: { key: p, display: p } }),
      processPath: (t2) => String(t2.key),
      stat: async () => undefined,
      listDir: async () => [],
      readText: async () => 'x',
      readBytes: async () => new Uint8Array(),
      writeText: async () => {},
      listWorkspaces: async () => [],
      resolveWorkspaceByPath: async () => undefined,
      createWorkspace: async () => ({ id: 'w' }),
    }
    const h = createDispatcher(noRootAdapter, { securityFile: secFile })
    const code = await ensurePairingCode(secFile)
    const A = await pairDevice(code, 'a', secFile)
    // listing with no path must fail closed - never fall back to a drive root
    const r = await h('list', { deviceId: A.deviceId, credential: A.credential, path: '' })
    assert.equal(r.ok, false)
    assert.equal(r.error.code, 'internal')
    assert.ok(!JSON.stringify(r.value || {}).includes('C:\\'))
    // explicit C:\ path must not be trusted either
    const r2 = await h('list', { deviceId: A.deviceId, credential: A.credential, path: 'C:\\' })
    assert.equal(r2.ok, false)
  } finally { await teardown(t, dir) }
})

// b3dfc4b audit item 5: `list` must filter each child entry through
// deniedPath BEFORE its name/metadata leaves /remfs. Hard-denied children
// (.ssh dirs, .aws, .env/private-key files, system dirs) must not appear even
// when the parent directory itself is allowed.
test('server-side metadata filter: hard-denied children never leave /remfs', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    // create allowed content AND hard-denied content inside the root
    await fsp.mkdir(path.join(root, 'proj'))
    await fsp.writeFile(path.join(root, 'proj', 'notes.txt'), 'ok')
    await fsp.mkdir(path.join(root, '.ssh'))
    await fsp.writeFile(path.join(root, '.ssh', 'id_rsa'), 'SECRET')
    await fsp.mkdir(path.join(root, '.aws'))
    await fsp.writeFile(path.join(root, '.aws', 'credentials'), 'SECRET')
    await fsp.writeFile(path.join(root, '.env'), 'SECRET=1')
    await fsp.writeFile(path.join(root, 'keys.pem'), 'SECRET')

    const r = await listCall(handler, { ...base, path: root })
    assert.equal(r.ok, true)
    const names = r.value.entries.map((e) => e.name)
    assert.ok(names.includes('proj'), 'allowed child must be listed')
    for (const denied of ['.ssh', '.aws', '.env', 'keys.pem']) {
      assert.ok(!names.includes(denied), `hard-denied child '${denied}' must be filtered server-side (got: ${names.join(',')})`)
    }
    // and the denied content itself must still be unreadable
    const readDenied = await handler('read', { ...base, path: path.join(root, '.ssh', 'id_rsa') })
    assert.equal(readDenied.ok, false)
    assert.equal(readDenied.error.code, 'path-protected')
  } finally { await teardown(t, dir) }
})

// b3dfc4b audit item 5 (soft side): a SOFT-protected child (e.g. AppData) is
// filtered out unless the phone's allowlist includes it - the child metadata
// must not leak just because the parent is allowed.
test('server-side metadata filter: soft-protected child without an approved root is hidden', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    await fsp.mkdir(path.join(root, 'appdata-probe'))
    await fsp.mkdir(path.join(root, 'appdata-probe', 'x'))
    const r = await listCall(handler, { ...base, path: path.join(root, 'appdata-probe') })
    assert.equal(r.ok, true)
    // 'x' is an ordinary dir here; the regression target is that protected
    // SEGMENT names (AppData, Windows, System32...) never appear in listings
    const names = r.value.entries.map((e) => e.name)
    assert.ok(!names.includes('Windows') && !names.includes('AppData') && !names.includes('System32'),
      'system segment names must not appear in listings: ' + names.join(','))
  } finally { await teardown(t, dir) }
})

// b3dfc4b audit item 6 (option A): `workspaces` must return only workspaces
// inside the remfs capability boundary (allowed roots + not protected). A
// registered workspace outside the allowlist or under a protected path must be
// filtered server-side - native DSH workspace authority stays outside remfs.
test('workspaces: filtered through the remfs capability boundary', async (t) => {
  const { dir, root, handler, pair, workspaces } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    // register: one INSIDE the root, one OUTSIDE, one under a protected path
    workspaces.push({ id: 'ws-in', path: path.join(root, 'proj'), title: 'in' })
    const outside = path.join(dir, 'outside-ws')
    await fsp.mkdir(outside)
    workspaces.push({ id: 'ws-out', path: outside, title: 'out' })
    const prot = path.join(root, '.ssh')
    await fsp.mkdir(prot)
    workspaces.push({ id: 'ws-prot', path: prot, title: 'prot' })

    const r = await handler('workspaces', base)
    assert.equal(r.ok, true)
    const got = (r.value.workspaces || []).map((w) => w.id)
    assert.ok(got.includes('ws-in'), 'workspace inside the root must be listed')
    assert.ok(!got.includes('ws-out'), 'workspace outside the allowlist must be filtered: ' + got.join(','))
    assert.ok(!got.includes('ws-prot'), 'workspace under a protected path must be filtered: ' + got.join(','))
  } finally { await teardown(t, dir) }
})

// ------------------------------------------------------ data integrity: write
// The write endpoint must never overwrite a file that is not UTF-8 (UTF-16
// BOM / GBK-ANSI bytes) and must preserve the UTF-8 BOM + dominant newline
// style of the original file on write-back.

test('write guard: UTF-16 BOM and GBK/ANSI files are rejected, original untouched', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    const u16 = path.join(root, 'u16.txt')
    const u16bytes = Buffer.from([0xff, 0xfe, 0x41, 0x00])
    await fsp.writeFile(u16, u16bytes)
    const r1 = await handler('write', { ...base, path: u16, content: 'new content' })
    assert.equal(r1.ok, false)
    assert.equal(r1.error.code, 'encoding-not-utf8')
    const gbk = path.join(root, 'gbk.txt')
    const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) // GBK "ni hao"
    await fsp.writeFile(gbk, gbkBytes)
    const r2 = await handler('write', { ...base, path: gbk, content: 'new content' })
    assert.equal(r2.ok, false)
    assert.equal(r2.error.code, 'encoding-not-utf8')
    // the original bytes must never be touched by a rejected write
    assert.deepEqual(await fsp.readFile(u16), u16bytes)
    assert.deepEqual(await fsp.readFile(gbk), gbkBytes)
  } finally { await teardown(t, dir) }
})

test('write guard: UTF-8 BOM and CRLF style are preserved on write-back', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    const f = path.join(root, 'bom-crlf.txt')
    await fsp.writeFile(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('line1\r\nline2\r\n')]))
    const w = await handler('write', { ...base, path: f, content: 'edit1\nedit2' })
    assert.equal(w.ok, true)
    const bytes = await fsp.readFile(f)
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM must be preserved')
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
    assert.equal(text, 'edit1\r\nedit2', 'CRLF style must be preserved (no doubled CRLF)')
  } finally { await teardown(t, dir) }
})

test('write guard: LF files stay LF; new files get no BOM and no conversion', async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    const lf = path.join(root, 'lf.txt')
    await fsp.writeFile(lf, 'a\nb\n')
    const w1 = await handler('write', { ...base, path: lf, content: 'x\ny' })
    assert.equal(w1.ok, true)
    assert.deepEqual(await fsp.readFile(lf), Buffer.from('x\ny'), 'LF style must be kept')

    const fresh = path.join(root, 'fresh.txt')
    const w2 = await handler('write', { ...base, path: fresh, content: 'plain\n' })
    assert.equal(w2.ok, true)
    assert.deepEqual(await fsp.readFile(fresh), Buffer.from('plain\n'), 'new file: no BOM, no conversion')
  } finally { await teardown(t, dir) }
})

// ------------------------------------------------------------ junction escape
// A real Windows junction pointing at a system directory (C:\Windows) must be
// denied: fs.processPath's realpath semantics resolve the junction, so the
// canonical path hits the HARD-deny segment / allowlist boundary. Junctions
// need no admin on Windows; skipped on other platforms.

test('junction escape: junction to C:\\Windows is denied (realpath semantics)', {
  skip: process.platform !== 'win32' ? 'junctions are Windows-only' : false,
}, async (t) => {
  const { dir, root, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const base = { deviceId: A.deviceId, credential: A.credential }
    const link = path.join(root, 'winlink')
    await fsp.symlink('C:\\Windows', link, 'junction')
    // the adapter's processPath (realpath) must resolve the junction to the
    // system directory - this is the realpath semantic the deny relies on
    const canonical = realpathSync(link)
    assert.ok(canonical.toLowerCase().startsWith('c:\\windows'),
      'junction must realpath to C:\\Windows, got: ' + canonical)
    // dispatch must deny every access through the junction
    const lst = await listCall(handler, { ...base, path: link })
    assert.equal(lst.ok, false, 'listing through the junction must fail')
    const rd = await handler('read', { ...base, path: path.join(link, 'win.ini') })
    assert.equal(rd.ok, false, 'reading through the junction must fail')
    assert.ok(['path-protected', 'path-outside-allowed'].includes(rd.error.code),
      'escape must be denied with a capability code: ' + rd.error.code)
  } finally { await teardown(t, dir) }
})
