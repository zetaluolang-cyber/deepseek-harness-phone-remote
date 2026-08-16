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

// Pocket Cockpit (v0.3 Phase 1): host must register the /pocket namespace
// (separate from /remfs), gate every operation on device auth + the cockpit
// capability, and the client must open an EXISTING session (handoff) via
// ctx.sessions.open(id) - never create a replacement.
test('host source: registers /pocket with device-auth + cockpit capability gate', () => {
  assert.match(HOST_SRC, /rpc\.handle\('\/pocket'/, 'host must register the /pocket channel')
  assert.match(HOST_SRC, /verifyDevice\(/, 'host must authenticate /pocket calls with the device credential')
  assert.match(HOST_SRC, /deviceHasCapability|capability-denied/,
    'host must gate /pocket on the cockpit device capability')
})

test('host source: /pocket implements cockpit.status/sessions and away start/stop (no approval yet)', () => {
  // host must wire the shared POCKET_OPS constants for every Phase-1 op
  assert.match(HOST_SRC, /POCKET_OPS\.STATUS/, 'host must implement cockpit.status')
  assert.match(HOST_SRC, /POCKET_OPS\.SESSIONS/, 'host must implement cockpit.sessions')
  assert.match(HOST_SRC, /POCKET_OPS\.AWAY_START/, 'host must implement cockpit.away.start')
  assert.match(HOST_SRC, /POCKET_OPS\.AWAY_STOP/, 'host must implement cockpit.away.stop')
  assert.match(HOST_SRC, /POCKET_OPS\.CHECK/, 'host must implement cockpit.check (since-last-check anchor)')
  // the shared contract defines the literal operation names (single source)
  assert.match(HOST_SRC, /POCKET_OPS/, 'host must use the shared cockpit contract')
  // Phase 1 explicitly has NO approval response operations
  assert.doesNotMatch(HOST_SRC, /approval\.respond|approval\.list/,
    'Phase 1 must not implement approval operations')
})

test('client source: cockpit handoff opens the EXISTING session (no replacement)', () => {
  assert.match(CLIENT_SRC, /sessions\.open\(/, 'client must use ctx.sessions.open(id) for handoff')
  const handoff = CLIENT_SRC.slice(CLIENT_SRC.indexOf('cockpit'))
  assert.doesNotMatch(handoff, /fork\(|create\(/,
    'handoff must never create a replacement session')
})

test('client source: cockpit is the default home, attention-first order, per-status CTA, since-last-check', () => {
  // design §21: Cockpit is the default view; away is NOT the hero button
  assert.match(CLIENT_SRC, /useState\('cockpit'\)/, 'cockpit must be the default tab')
  assert.match(CLIENT_SRC, /NEEDS YOU|Needs You/, 'client must render Needs You section')
  assert.match(CLIENT_SRC, /Catch up|catchup/, 'Finished card must offer Catch up')
  assert.match(CLIENT_SRC, /Inspect|inspect/, 'Failed card must offer Inspect')
  assert.match(CLIENT_SRC, /Review|review/, 'Needs You card must offer Review')
  // since-last-check copy (design §10)
  assert.match(CLIENT_SRC, /lastCockpitViewedAt|Since your last check|since your last check/,
    'client must render the automatic since-last-check context')
})

test('client source: cockpit is an INDEPENDENT entry (header button opens the cockpit directly, not the workbench drawer)', () => {
  // design §16/§21: the header button opens the cockpit, not the file drawer
  assert.match(CLIENT_SRC, /setCockpitOpen/, 'client must own a dedicated cockpit-open state')
  assert.match(CLIENT_SRC, /CockpitOverlayBridge/, 'client must render a dedicated cockpit overlay')
  assert.match(CLIENT_SRC, /remfs\.cockpit/, 'client must register a dedicated cockpit entry in the header slot')
  assert.match(CLIENT_SRC, /WorkbenchToggle/, 'client keeps a separate workbench entry (Files/Sessions)')
})

// Agent Presence Phase B: Orb + Task Board + notifications consume ONLY the
// presence DTOs (single source of truth, design §25); Open uses sessions.open.
test('client source: presence Orb consumes presence.tasks and opens via sessions.open', () => {
  assert.match(CLIENT_SRC, /presence\.tasks/, 'Orb must fetch the presence task snapshot')
  assert.match(CLIENT_SRC, /PresenceOrb/, 'client must render the presence Orb')
  assert.match(CLIENT_SRC, /PresenceBoard/, 'client must render the Task Board')
  assert.match(CLIENT_SRC, /sessionsApi\.open\(|sessionsApi && typeof sessionsApi\.open/,
    'Orb/Board Open must enter the EXISTING session via sessions.open')
  const orbBlock = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function PresenceOrb'))
  assert.doesNotMatch(orbBlock, /fork\(|create\(/, 'Orb/Board must never create a replacement session')
})

test('client source: Orb is a floating ball - shell.overlay, fixed, draggable, icon+tag+accent', () => {
  // design §10-11: ambient floating indicator over the page, not a header item
  const overlaySection = CLIENT_SRC.slice(CLIENT_SRC.indexOf('shell.overlay'))
  assert.match(overlaySection, /remfs\.presence\.orb/, 'Orb must register in shell.overlay (page-level, not header)')
  const orbBlock = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function PresenceOrb'))
  assert.match(orbBlock, /remfs-orbwrap/, 'Orb must render a floating ball wrapper')
  assert.match(orbBlock, /setPointerCapture/, 'Orb must be draggable via pointer capture')
  assert.match(orbBlock, /onPointerMove/, 'drag must track pointer movement')
  assert.match(orbBlock, /draggedRef\.current/, 'drag must be distinguishable from click')
  assert.match(CLIENT_SRC, /\.remfs-orbwrap\{position:fixed/, 'ball CSS must float over the page')
  assert.match(CLIENT_SRC, /remfs-orb-tag/, 'ball keeps a text tag (icon+text, never color-only)')
  assert.match(orbBlock, /borderColor:\s*orb\.color/, 'ball accent ring must come from orbState.color')
  // brand-whale logo face (user-requested: no more dark plain ball)
  assert.match(orbBlock, /WHALE_LOGO_PATH/, 'ball face must be the brand whale logo')
  assert.match(orbBlock, /remfs-orb-logo/, 'whale logo must render inside the ball')
  assert.match(orbBlock, /remfs-orb-badge/, 'state icon must live in a corner badge')
  assert.match(CLIENT_SRC, /linear-gradient\(145deg/, 'ball must be a bright gradient, not a dark disc')
})

test('client source: notification rules - NEEDS_USER/FAILED only, never RUNNING; click opens the session', () => {
  assert.match(CLIENT_SRC, /P_NOTIFY_DEFAULT/, 'client must define notification defaults')
  assert.match(CLIENT_SRC, /\[P_NEEDS\]:\s*true/, 'NEEDS_USER must notify')
  assert.match(CLIENT_SRC, /\[P_FAILED\]:\s*true/, 'FAILED must notify')
  assert.match(CLIENT_SRC, /\[P_RUNNING\]:\s*false/, 'RUNNING must never notify')
  assert.match(CLIENT_SRC, /\[P_STALE\]:\s*false/, 'STALE must not interrupt by default')
  assert.match(CLIENT_SRC, /new Notification\(/, 'client must use the Notification API')
  assert.match(CLIENT_SRC, /sessionsApi\.open\(task\.sessionId\)|__remfsSessionsApi\.open\(task\.sessionId\)/,
    'notification click must open the corresponding session directly')
})

test('client source: revoke sends targetDeviceId (never { id })', () => {
  assert.match(CLIENT_SRC, /rpc\('revoke',\s*\{\s*targetDeviceId:\s*id\s*\}/,
    'client must send { targetDeviceId } for revoke')
  assert.doesNotMatch(CLIENT_SRC, /rpc\('revoke',\s*\{\s*id:/,
    'client must NOT send { id } for revoke')
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
