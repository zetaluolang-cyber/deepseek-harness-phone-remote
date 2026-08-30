// Client -> RPC payload -> dispatcher contract regression test.
// The browser client cannot be imported, so this test (1) pins the payload
// the client source actually produces for `revoke`, and (2) feeds that exact
// shape through the real dispatcher to prove the protocol lines up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { promises as fsp } from 'node:fs'
import { realpathSync } from 'node:fs'
import { createDispatcher } from '../lib/dispatch.js'
import { ensurePairingCode, pairDevice } from '../lib/security.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8')
const HOST_SRC = readFileSync(path.join(HERE, '..', 'lib', 'host.js'), 'utf8')
const POCKET_SRC = readFileSync(path.join(HERE, '..', 'lib', 'presence', 'pocket.js'), 'utf8')

test('host source: no whole-drive (C:\\) fallback for the workspace root', () => {
  assert.doesNotMatch(HOST_SRC, /return 'C:\\\\'|workspaceRoot.*C:\\\\/,
    'host must fail closed instead of widening the root to the whole drive')
  assert.match(HOST_SRC, /fail closed/, 'host must contain the fail-closed guard')
})

// 65c52ca audit item 2: the rotation watcher must call rotatePairingCode()
// (forced rotation), never ensurePairingCode() (which returns null while the
// current code is still valid -> refresh_pairing.ps1 would do nothing).
test('host source: startup uses ensurePairingCode, rotation watcher uses rotatePairingCode', () => {
  assert.match(HOST_SRC, /ensurePairingCode\(\)/, 'startup must ensure a pairing code')
  const watchCalls = [...HOST_SRC.matchAll(/rotatePairingCode\(\)/g)]
  assert.ok(watchCalls.length >= 1, 'rotation watcher must call rotatePairingCode()')
  // the watcher must NOT fall back to ensurePairingCode (no-op rotation)
  const watcher = HOST_SRC.slice(HOST_SRC.indexOf('pairing-rotation'))
  assert.doesNotMatch(watcher, /ensurePairingCode\(\)/,
    'rotation watcher must force a NEW code via rotatePairingCode')
})

// 65c52ca audit item 4: host.js declares inject ['connection','fs'] but safe
// workspace-root resolution depends on sandboxPolicy/workspaceRegistry during
// apply(). The required service lifecycle must be explicit (no accidental
// plugin ordering), and resolvedRoot (computed once) must be used everywhere -
// readAllowedFile/writeAllowedFile/resolvePath must NOT re-call workspaceRoot().
test('host source: sandboxPolicy/workspaceRegistry are explicit injected services', () => {
  assert.match(HOST_SRC, /inject:\s*\[[^\]]*'sandboxPolicy'[^\]]*\]/,
    'host must declare sandboxPolicy in inject (explicit lifecycle)')
  assert.match(HOST_SRC, /inject:\s*\[[^\]]*'workspaceRegistry'[^\]]*\]/,
    'host must declare workspaceRegistry in inject (explicit lifecycle)')
})

test('host source: resolvedRoot is used everywhere after apply (no re-resolution)', () => {
  // resolvedRoot computed once at apply...
  assert.match(HOST_SRC, /resolvedRoot\s*=\s*workspaceRoot\(\)/, 'resolvedRoot must be computed once')
  // ...and the adapter methods must reference resolvedRoot, not workspaceRoot()
  const methods = HOST_SRC.slice(HOST_SRC.indexOf('const adapter'))
  assert.doesNotMatch(methods, /workspaceRoot\(\)/,
    'adapter methods must use the resolved root, never re-resolve workspaceRoot()')
})

// 65c52ca audit item 7: client.js must NOT scatter generated DSH CSS-module
// selectors (.pI_x6G_*, .uV2eYG_*, ._7KE1Ra_*) through the stylesheet. All
// upstream-selector compatibility must live in ONE adapter object so a DSH
// upgrade touches a single place.
test('client source: upstream CSS-module selectors are isolated in one adapter', () => {
  assert.match(CLIENT_SRC, /UPSTREAM_SELECTORS\s*=\s*\{/, 'client must define an upstream-selector adapter')
  const cssBlock = CLIENT_SRC.slice(CLIENT_SRC.indexOf('const CSS'))
  // every upstream selector in the stylesheet must come from the adapter
  const hashed = cssBlock.match(/\.(pI_x6G|uV2eYG|_7KE1Ra)_[A-Za-z0-9]+/g) || []
  assert.equal(hashed.length, 0,
    'CSS must reference selectors via the adapter, never raw hashed names: ' + hashed.join(', '))
  // the adapter itself still pins the current hashed names (single source of truth)
  for (const name of ['pI_x6G_frame', 'pI_x6G_sidebarCol', 'uV2eYG_row', '_7KE1Ra_root']) {
    assert.ok(CLIENT_SRC.includes(name), 'adapter must pin the upstream selector ' + name)
  }
})

// /pocket (Agent Presence): host registers the namespace (separate from
// /remfs), authenticates every call with the device credential, and
// implements ONLY the frozen presence operations (docs/presence-api-v1.md).
// The former Pocket Cockpit and its capability gate were removed.
test('host source: registers /pocket wired to the extracted dispatcher', () => {
  assert.match(HOST_SRC, /rpc\.handle\('\/pocket'/, 'host must register the /pocket channel')
  assert.match(HOST_SRC, /createPocketHandler\(\{/, 'host must wire the unit-tested pocket dispatcher')
  assert.match(HOST_SRC, /pocketStrict: remfsOptions\.pocketStrict/, 'host must pass the operator switch through')
  assert.match(HOST_SRC, /readRemfsOptions\(\)/, 'host must read the operator options once at apply')
  // The dispatcher itself: authenticates, implements the presence ops, fails
  // closed on unknown endpoints, and gates push ops on the files capability.
  // (Behaviour is pinned in test/pocket.test.js; this is the wiring contract.)
  assert.match(POCKET_SRC, /verifyDevice\(/, 'dispatcher must authenticate with the device credential')
  assert.match(POCKET_SRC, /PRESENCE_OPS\.STATUS/, 'dispatcher must implement presence.status')
  assert.match(POCKET_SRC, /PRESENCE_OPS\.TASKS/, 'dispatcher must implement presence.tasks')
  assert.match(POCKET_SRC, /deviceHasCapability\(authRes\.device, 'files'\)/, 'push ops must be capability-gated')
  assert.match(POCKET_SRC, /bad-request/, 'unknown endpoints must fail with bad-request')
  // cockpit is gone: no POCKET_OPS, no cockpit capability gate, no away ops
  for (const src of [HOST_SRC, POCKET_SRC]) {
    assert.doesNotMatch(src, /POCKET_OPS/, 'cockpit operations must be removed')
    assert.doesNotMatch(src, /cockpit\.sessions|cockpit\.away|cockpit\.check/, 'cockpit ops must be removed')
  }
})

test('client source: presence handoff opens the EXISTING session (no replacement)', () => {
  assert.match(CLIENT_SRC, /sessions\.open\(/, 'client must use ctx.sessions.open(id) for handoff')
  const handoff = CLIENT_SRC.slice(CLIENT_SRC.indexOf('__remfsSessionsApi'))
  assert.doesNotMatch(handoff, /fork\(|create\(/,
    'handoff must never create a replacement session')
})

test('client source: cockpit UI is fully removed', () => {
  assert.doesNotMatch(CLIENT_SRC, /CockpitPanel|CockpitOverlayBridge|HeaderToggle/,
    'cockpit components must be removed')
  assert.doesNotMatch(CLIENT_SRC, /remfs\.cockpit|setCockpitOpen|tabCockpit|headCockpit/,
    'cockpit entries/i18n must be removed')
  assert.match(CLIENT_SRC, /useState\('files'\)/, 'workbench must default to Files (no cockpit tab)')
  assert.match(CLIENT_SRC, /WorkbenchToggle/, 'client keeps the workbench entry (Files/Sessions)')
})

// The desktop companion owns ambient presence. The browser keeps the useful
// Task Board, but exposes it as a normal header action instead of covering the
// Harness UI with a second floating ball.
test('client source: Task Board stays available and opens existing sessions', () => {
  assert.match(CLIENT_SRC, /presence\.tasks/, 'Task Board must fetch the presence task snapshot')
  assert.match(CLIENT_SRC, /PresenceBoard/, 'client must render the Task Board')
  assert.match(CLIENT_SRC, /PresenceBoardToggle/, 'Task Board needs a compact header entry')
  assert.match(CLIENT_SRC, /remfs\.presence\.tasks/, 'Task Board header entry must be registered')
  assert.match(CLIENT_SRC, /counts\.needsUser/, 'Task Board header must use the actual needsUser group key')
  assert.doesNotMatch(CLIENT_SRC, /counts\.needsYou/, 'Task Board must not render an undefined count')
  assert.match(CLIENT_SRC, /sessionsApi\.open\(|sessionsApi && typeof sessionsApi\.open/,
    'Task Board Open must enter the EXISTING session via sessions.open')
  const boardBlock = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function PresenceBoard'))
  assert.doesNotMatch(boardBlock, /fork\(|create\(/, 'Task Board must never create a replacement session')
})

test('client source: browser floating ball is not registered or styled', () => {
  assert.doesNotMatch(CLIENT_SRC, /id:\s*'remfs\.presence\.orb'/,
    'desktop companion is the only ambient presence surface')
  assert.doesNotMatch(CLIENT_SRC, /\.remfs-orbwrap\{position:fixed/,
    'browser must not reserve fixed overlay space for a floating ball')
})

test('client source: revoke sends targetDeviceId (never { id })', () => {
  assert.match(CLIENT_SRC, /rpc\('revoke',\s*\{\s*targetDeviceId:\s*id\s*\}/,
    'client must send { targetDeviceId } for revoke')
  assert.doesNotMatch(CLIENT_SRC, /rpc\('revoke',\s*\{\s*id:/,
    'client must NOT send { id } for revoke')
})

// Data integrity: the upload path must inspect the RAW bytes (not
// file.text(), which already mangles non-UTF-8) and refuse UTF-16 BOM /
// GBK-ANSI content, keeping a UTF-8 BOM. The dispatcher rejects the same
// files server-side with encoding-not-utf8, which the client maps to a
// friendly message.
test('client source: upload reads raw bytes and rejects non-UTF-8 (encoding guard)', () => {
  assert.match(CLIENT_SRC, /file\.arrayBuffer\(\)/, 'upload must read the raw bytes, not file.text()')
  assert.doesNotMatch(CLIENT_SRC, /file\.text\(\)\.then/, 'file.text() would mangle non-UTF-8 before detection')
  assert.match(CLIENT_SRC, /encValidUtf8\(bytes\)/, 'client must validate the bytes as strict UTF-8')
  assert.match(CLIENT_SRC, /encHasUtf16Bom\(bytes\)/, 'client must reject UTF-16 BOMs')
  assert.match(CLIENT_SRC, /new TextDecoder\('utf-8',\s*\{\s*fatal:\s*true\s*\}\)/, 'strict UTF-8 decoder (fatal)')
  assert.match(CLIENT_SRC, /encNotUtf8/, 'client must surface the non-UTF-8 message')
  assert.match(CLIENT_SRC, /encoding-not-utf8/, 'client friendlyErr must map the dispatcher code')
  assert.match(CLIENT_SRC, /encHasUtf8Bom\(bytes\)[\s\S]*?\\uFEFF/, 'a UTF-8 BOM must be preserved on upload')
})

async function setup() {
  const dir = await fsp.mkdtemp(path.join(process.cwd(), '.tmp-contract-'))
  const root = path.join(dir, 'ws')
  await fsp.mkdir(root)
  const workspaces = []
  const adapter = {
    workspaceRoot: () => root,
    policy: () => undefined,
    readAllowedFile: async () => ({ exists: false }),
    writeAllowedFile: async () => {},
    resolvePath: async (p) => ({ target: { key: path.resolve(root, p || ''), display: p } }),
    processPath: (t) => { try { return realpathSync(t.key) } catch { return t.key } },
    stat: async (t) => { const s = await fsp.stat(t.key); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } },
    listDir: async () => [],
    readText: async () => 'x',
    readBytes: async () => new Uint8Array(),
    writeText: async () => {},
    listWorkspaces: async () => workspaces.slice(),
    resolveWorkspaceByPath: async () => undefined,
    createWorkspace: async (p) => { const w = { id: 'w', path: p }; workspaces.push(w); return w },
  }
  const secFile = path.join(dir, 'sec.json')
  const handler = createDispatcher(adapter, { securityFile: secFile })
  const pair = async (name) => {
    const code = await ensurePairingCode(secFile)
    const res = await pairDevice(code, name, secFile)
    return { deviceId: res.deviceId, credential: res.credential }
  }
  return { dir, secFile, handler, pair }
}

test('dispatcher: the client-shaped revoke payload revokes the TARGET, not the caller', async (t) => {
  const { dir, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const B = await pair('device-b')
    // Exactly what client.js produces after rpc() attaches auth:
    const revokePayload = { targetDeviceId: B.deviceId, deviceId: A.deviceId, credential: A.credential }
    const rev = await handler('revoke', revokePayload)
    assert.equal(rev.ok, true)
    // B dead, A alive
    const b = await handler('list', { deviceId: B.deviceId, credential: B.credential, path: '' })
    assert.equal(b.error.code, 'auth-invalid')
    const a = await handler('list', { deviceId: A.deviceId, credential: A.credential, path: '' })
    assert.equal(a.ok, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('dispatcher: the OLD broken payload ({ id }) is rejected and revokes nothing', async (t) => {
  const { dir, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const B = await pair('device-b')
    const bad = await handler('revoke', { id: B.deviceId, deviceId: A.deviceId, credential: A.credential })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    const a = await handler('list', { deviceId: A.deviceId, credential: A.credential, path: '' })
    assert.equal(a.ok, true, 'caller must stay authorized')
    const b = await handler('list', { deviceId: B.deviceId, credential: B.credential, path: '' })
    assert.equal(b.ok, true, 'target must stay authorized')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
