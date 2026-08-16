// Filesystem + authentication security tests for the /remfs bridge.
// Run: node --test test/security.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  normPath, hasTraversal, isWithin, segmentsDenied, deniedPath, canSetRoots,
  ensurePairingCode, rotatePairingCode, pairDevice, verifyDevice, listDevices,
  revokeDevice, revokeAllDevices, parsePairingCode, formatPairingCode,
  securityFile, buildCrumbs, deviceHasCapability,
} from '../lib/security.js'

const DOCS = path.join(os.homedir(), 'Documents')
const ROOT = DOCS // typical workspace root

async function tempFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remfs-sec-'))
  return path.join(dir, 'security.json')
}

// --------------------------------------------------------------- path tests

test('path traversal: rejects .. segments', () => {
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents\\..\\..\\Windows'), true)
  assert.equal(hasTraversal('../../etc/passwd'), true)
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents\\sub\\..\\x'), true)
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents'), false)
})

test('path traversal: rejects UNC / network paths', () => {
  assert.equal(hasTraversal('\\\\server\\share\\file.txt'), true)
  assert.equal(hasTraversal('//server/share'), true)
})

test('isWithin: absolute-path bypass blocked', () => {
  assert.equal(isWithin('C:\\Windows\\System32', [ROOT]), false)
  assert.equal(isWithin('C:\\Users\\zeta\\.ssh\\id_rsa', [ROOT]), false)
  assert.equal(isWithin(ROOT + '\\sub', [ROOT]), true)
  assert.equal(isWithin(ROOT, [ROOT]), true)
})

test('isWithin: case-insensitive matching', () => {
  // Platform-independent: pure string comparison (no os.homedir involved).
  assert.equal(isWithin('C:\\USERS\\zeta\\DOCUMENTS\\file.txt', ['C:\\Users\\zeta\\Documents']), true)
  assert.equal(isWithin('c:\\users\\zeta\\documents\\sub\\x', ['C:\\Users\\zeta\\Documents']), true)
  assert.equal(isWithin('C:\\Users\\zeta\\Other', ['C:\\Users\\zeta\\Documents']), false)
})

test('normPath: mixed separators (C:\\ vs C:/) have identical security semantics', () => {
  assert.equal(normPath('C:\\Users\\x\\Documents\\a'), normPath('C:/Users/x/Documents/a'))
  assert.equal(normPath('C:/Users/x/Documents'), 'c:\\users\\x\\documents')
  // containment is separator-agnostic in both directions
  assert.equal(isWithin('C:/Users/x/Documents/a', ['C:\\Users\\x\\Documents']), true)
  assert.equal(isWithin('C:\\Users\\x\\Documents\\a', ['C:/Users/x/Documents']), true)
  assert.equal(isWithin('C:/Users/x/Other', ['C:\\Users\\x\\Documents']), false)
  // protection is separator-agnostic
  assert.equal(deniedPath('C:/Users/x/Documents/.credentials.yaml', []), true)
  assert.equal(deniedPath('C:\\Users\\x\\Documents\\.credentials.yaml', []), true)
  assert.equal(deniedPath('C:/Users/x/Documents/xwechat_files/a', []), true)
  // traversal detection is separator-agnostic
  assert.equal(hasTraversal('C:/a/../b'), true)
  assert.equal(hasTraversal('C:\\a\\..\\b'), true)
})

test('protected credential access is denied', () => {
  const wp = [] // no registered workspace escape
  for (const p of [
    ROOT + '\\.credentials.yaml',
    ROOT + '\\.ssh\\id_rsa',
    ROOT + '\\proj\\keys.pem',
    ROOT + '\\proj\\.env',
    'C:\\Users\\zeta\\.aws\\credentials',
    'C:\\Windows\\System32',
    'C:\\Users\\zeta\\Documents\\xwechat_files\\data',
    'C:\\Users\\zeta\\Documents\\KingsoftData\\x',
  ]) {
    assert.equal(deniedPath(p, wp), true, 'should be denied: ' + p)
  }
})

test('registered workspace inside protected area stays reachable', () => {
  const wp = ['C:\\Users\\zeta\\Documents\\xwechat_files\\wxid_x\\business\\01']
  assert.equal(deniedPath(wp[0], wp), false)
  assert.equal(deniedPath(wp[0] + '\\notes.txt', wp), false)
  // sibling inside the protected area but outside the workspace: still denied
  assert.equal(deniedPath('C:\\Users\\zeta\\Documents\\xwechat_files\\other', wp), true)
  // normal workspace root (Documents) does NOT lift the deny
  assert.equal(deniedPath(ROOT + '\\xwechat_files\\data', [ROOT]), true)
})

// 65c52ca audit item 1: HARD protected paths (credentials, private keys,
// system files) must NEVER become reachable just because their parent
// protected directory was registered as a workspace. A workspace registered
// under .ssh/.aws/Windows/AppData must not make those files accessible.
test('hard deny: .ssh\\id_rsa stays denied even when .ssh is a registered workspace', () => {
  const wp = ['C:\\Users\\x\\.ssh'] // attacker registers the protected dir itself
  assert.equal(deniedPath('C:\\Users\\x\\.ssh\\id_rsa', wp), true)
  assert.equal(deniedPath('C:\\Users\\x\\.ssh\\id_ed25519', wp), true)
  // nested registration cannot widen either
  assert.equal(deniedPath('C:\\Users\\x\\.ssh\\deep\\id_rsa', ['C:\\Users\\x\\.ssh\\deep']), true)
})

test('hard deny: .aws\\credentials stays denied even when .aws is a registered workspace', () => {
  const wp = ['C:\\Users\\x\\.aws']
  assert.equal(deniedPath('C:\\Users\\x\\.aws\\credentials', wp), true)
  // unrelated file under .aws is still protected unless the workspace is
  // registered EXACTLY under the protected area (soft-deny semantics)
  assert.equal(deniedPath('C:\\Users\\x\\.aws\\config', wp), true)
})

test('hard deny: C:\\Windows\\System32 stays denied even when C:\\Windows is a registered workspace', () => {
  const wp = ['C:\\Windows']
  assert.equal(deniedPath('C:\\Windows\\System32', wp), true)
  assert.equal(deniedPath('C:\\Windows\\System32\\drivers\\etc\\hosts', wp), true)
  assert.equal(deniedPath('C:\\Windows\\SysWOW64\\ntdll.dll', wp), true)
})

test('allowlist: phone can only narrow roots, never widen', () => {
  const cur = [ROOT]
  assert.equal(canSetRoots([ROOT + '\\sub'], cur), true) // narrow to a sub-path
  assert.equal(canSetRoots([ROOT], cur), true) // unchanged
  assert.equal(canSetRoots([], cur), false) // cannot empty it
  assert.equal(canSetRoots(['C:\\'], cur), false) // cannot widen to C:\
  assert.equal(canSetRoots(['C:\\Users\\zeta'], cur), false) // cannot widen
  assert.equal(canSetRoots(['D:\\media', ROOT], cur), false) // no unrelated roots
})

// ------------------------------------------------------------ auth tests

test('pairing code: single use, valid once', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    assert.ok(code && code.includes('-'))
    const parsed = parsePairingCode(code)
    assert.equal(parsed.length, 32)
    assert.equal(formatPairingCode(parsed), code)

    const a = await pairDevice(code, 'test-phone', f)
    assert.ok(a.deviceId && a.credential)
    // reuse must fail (single use)
    const b = await pairDevice(code, 'second', f)
    assert.equal(b.error, 'pairing-used')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('pairing code: wrong code rejected, expiry honored', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const bad = await pairDevice('deadbeef-deadbeef-deadbeef-deadbeef', 'x', f)
    assert.equal(bad.error, 'pairing-invalid')
    // simulate expiry
    const { securityFile: _sf, ...rest } = await import('../lib/security.js')
    void rest
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
    raw.pairing.expiresAt = Date.now() - 1000
    await (await import('node:fs/promises')).writeFile(f, JSON.stringify(raw), 'utf8')
    const expired = await pairDevice(code, 'x', f)
    assert.equal(expired.error, 'pairing-expired')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('device credential: valid auth, invalid auth, revoked auth', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const { deviceId, credential } = await pairDevice(code, 'phone-a', f)
    assert.equal((await verifyDevice(deviceId, credential, f)).ok, true)
    assert.equal((await verifyDevice(deviceId, 'wrong', f)).error, 'auth-invalid')
    assert.equal((await verifyDevice('nope', credential, f)).error, 'auth-invalid')
    assert.equal((await verifyDevice(null, credential, f)).error, 'auth-required')

    const devices = await listDevices(f)
    assert.equal(devices.length, 1)
    assert.equal(devices[0].name, 'phone-a')
    // hash only — plaintext credential must not be stored
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
    assert.ok(!JSON.stringify(raw).includes(credential))

    await revokeDevice(deviceId, f)
    assert.equal((await verifyDevice(deviceId, credential, f)).error, 'auth-invalid')
    assert.equal((await listDevices(f)).length, 0)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('revoke all: all devices invalidated, pairing cleared', async () => {
  const f = await tempFile()
  try {
    const c1 = await ensurePairingCode(f)
    const d1 = await pairDevice(c1, 'a', f)
    await ensurePairingCode(f) // fresh code for second device
    const c2 = await (await import('../lib/security.js')).ensurePairingCode ? null : null
    // ensurePairingCode returns null when a valid code already exists; generate one
    const code2 = await freshCode(f)
    const d2 = await pairDevice(code2, 'b', f)
    assert.equal((await verifyDevice(d1.deviceId, d1.credential, f)).ok, true)
    assert.equal((await verifyDevice(d2.deviceId, d2.credential, f)).ok, true)
    await revokeAllDevices(f)
    assert.equal((await verifyDevice(d1.deviceId, d1.credential, f)).error, 'auth-invalid')
    assert.equal((await verifyDevice(d2.deviceId, d2.credential, f)).error, 'auth-invalid')
    assert.equal((await listDevices(f)).length, 0)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

async function freshCode(f) {
  // securityFile() default collides with the real one; use the temp store directly
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
  raw.pairing = null
  await (await import('node:fs/promises')).writeFile(f, JSON.stringify(raw), 'utf8')
  return ensurePairingCode(f)
}

// b3dfc4b audit item 7: pairingTxtUsable() must verify the plaintext in the
// .txt actually HASHES to the active store.pairing.codeHash - not merely that
// the file is non-empty / non-CONSUMED. A stale/forged .txt (e.g. left over
// from a previous pairing) must NOT be treated as the current code, and
// ensurePairingCode must regenerate instead of stranding the user with an
// unrecoverable hash.
test('ensurePairingCode: a .txt whose plaintext does not hash to the active codeHash is rejected (regenerate)', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    const code = await ensurePairingCode(f)
    assert.ok(code)
    // overwrite the .txt with a DIFFERENT valid-looking code that does NOT
    // hash to the store's codeHash (stale/forged txt)
    const forged = formatPairingCode('a1b2c3d4e5f60718293a4b5c6d7e8f90')
    await fsp.writeFile(path.join(path.dirname(f), 'remfs-pairing.txt'), forged + '\nstale\n', 'utf8')
    const regenerated = await ensurePairingCode(f)
    assert.ok(regenerated && regenerated !== code,
      'a txt that does not hash to the active codeHash must force regeneration')
    const p = await pairDevice(regenerated, 'phone', f)
    assert.ok(p.deviceId && p.credential)
    // the forged code must NOT pair (either invalid, or used because the
    // store now holds a different code)
    const forgedPair = await pairDevice(forged, 'forged', f)
    assert.ok(!forgedPair.deviceId, 'forged code must never pair')
    assert.ok(forgedPair.error === 'pairing-invalid' || forgedPair.error === 'pairing-used',
      'forged code must be rejected, got: ' + forgedPair.error)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

// b3dfc4b audit item 7: revokeAllDevices() clears pairing, so the .txt must be
// invalidated (marked CONSUMED) - a stale code must not keep looking usable.
test('revokeAllDevices: invalidates the pairing txt so the old code cannot mislead', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    const code = await ensurePairingCode(f)
    const d = await pairDevice(code, 'phone', f)
    assert.ok(d.deviceId)
    // after consumption the txt is CONSUMED; ensurePairingCode mints a new code
    const code2 = await ensurePairingCode(f)
    assert.ok(code2)
    await revokeAllDevices(f)
    const txt = path.join(path.dirname(f), 'remfs-pairing.txt')
    const body = await fsp.readFile(txt, 'utf8')
    assert.ok(/CONSUMED/.test(body), 'revokeAllDevices must invalidate the pairing txt (got: ' + body + ')')
    // a fresh ensurePairingCode now mints a code that actually pairs
    const code3 = await ensurePairingCode(f)
    assert.ok(code3)
    const p = await pairDevice(code3, 'new-phone', f)
    assert.ok(p.deviceId && p.credential)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('default store location is under the DSH home', () => {
  assert.ok(securityFile().startsWith(path.join(os.homedir(), '.dsh')))
  assert.ok(!securityFile().includes('Documents'))
})

test('buildCrumbs: each crumb captures its own prefix (no shared accumulator)', () => {
  const crumbs = buildCrumbs('C:\\Users\\zeta\\Documents\\proj')
  assert.deepEqual(crumbs.map((c) => c.path), [
    'C:',
    'C:\\Users',
    'C:\\Users\\zeta',
    'C:\\Users\\zeta\\Documents',
    'C:\\Users\\zeta\\Documents\\proj',
  ])
  assert.deepEqual(crumbs.map((c) => c.last), [false, false, false, false, true])
  assert.deepEqual(buildCrumbs(''), [])
})

test('pairing txt: consumed code is marked so it cannot mislead', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    await pairDevice(code, 'phone', f)
    const txt = path.join(path.dirname(f), 'remfs-pairing.txt')
    const body = await (await import('node:fs/promises')).readFile(txt, 'utf8')
    assert.ok(/CONSUMED/.test(body))
    // regeneration after consumption returns a fresh plaintext code
    const code2 = await ensurePairingCode(f)
    assert.ok(code2 && code2 !== code)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

// 65c52ca audit item 2: refresh_pairing.ps1 must FORCE rotation. The host
// watcher previously called ensurePairingCode(), which returns null while the
// current code is still valid - so a manual refresh did nothing. rotatePairingCode()
// must always mint a new code and overwrite the store + .txt.
test('rotatePairingCode: forces a NEW code even while the current code is still valid', async () => {
  const f = await tempFile()
  try {
    const first = await ensurePairingCode(f)
    assert.ok(first, 'a code must exist')
    // current code is still valid -> ensurePairingCode returns null (no rotation)
    assert.equal(await ensurePairingCode(f), null)
    // rotatePairingCode must ALWAYS produce a fresh code
    const rotated = await rotatePairingCode(f)
    assert.ok(rotated && rotated !== first)
    // the .txt is rewritten with the fresh plaintext (check BEFORE pairing,
    // which marks the txt as consumed)
    const txt = path.join(path.dirname(f), 'remfs-pairing.txt')
    const body = await (await import('node:fs/promises')).readFile(txt, 'utf8')
    assert.ok(body.startsWith(rotated))
    // the old code must no longer pair
    const oldPair = await pairDevice(first, 'old-phone', f)
    assert.equal(oldPair.error, 'pairing-invalid')
    // the new code pairs fine
    const newPair = await pairDevice(rotated, 'new-phone', f)
    assert.ok(newPair.deviceId && newPair.credential)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('rotatePairingCode: works with no prior pairing state', async () => {
  const f = await tempFile()
  try {
    const code = await rotatePairingCode(f)
    assert.ok(code && code.includes('-'))
    const p = await pairDevice(code, 'phone', f)
    assert.ok(p.deviceId && p.credential)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('ensurePairingCode: missing .txt while a valid unrecoverable codeHash remains -> regenerate', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    const code = await ensurePairingCode(f)
    // delete the .txt: the store still holds a VALID, unexpired codeHash, but
    // the plaintext is now unrecoverable - the user could never pair. A naive
    // "still valid" check returns null and strands the user; ensurePairingCode
    // must detect the missing txt and regenerate.
    await fsp.rm(path.join(path.dirname(f), 'remfs-pairing.txt'), { force: true })
    const regenerated = await ensurePairingCode(f)
    assert.ok(regenerated && regenerated !== code, 'must regenerate when the txt is unrecoverable')
    const p = await pairDevice(regenerated, 'phone', f)
    assert.ok(p.deviceId && p.credential)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('concurrent verify/revoke: revoked credential never resurrects', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const { deviceId, credential } = await pairDevice(code, 'phone', f)
    await Promise.all([
      verifyDevice(deviceId, credential, f),
      verifyDevice(deviceId, credential, f),
      revokeDevice(deviceId, f),
      verifyDevice(deviceId, credential, f),
    ])
    const after = await verifyDevice(deviceId, credential, f)
    assert.equal(after.error, 'auth-invalid')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('corrupt store: fails closed with a backup, never silently resets', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    await fsp.writeFile(f, '{ not json', 'utf8')
    const v1 = await verifyDevice('x', 'y', f)
    assert.equal(v1.error, 'store-corrupt')
    // a backup of the bad content exists and the original is NOT overwritten
    const dir = path.dirname(f)
    const base = path.basename(f)
    const backups = (await fsp.readdir(dir)).filter((n) => n.indexOf(base + '.corrupt-') === 0)
    assert.ok(backups.length >= 1, 'corrupt store must be backed up')
    assert.equal(await fsp.readFile(f, 'utf8'), '{ not json', 'original must not be silently overwritten')
    assert.equal(await fsp.readFile(path.join(dir, backups[0]), 'utf8'), '{ not json')
    // state is NOT reset: a second operation still fails closed
    const v2 = await verifyDevice('x', 'y', f)
    assert.equal(v2.error, 'store-corrupt')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('permission/read error on the store fails closed', async (t) => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    // A directory where the store file should be: readFile fails (EISDIR).
    await fsp.mkdir(f)
    const v = await verifyDevice('x', 'y', f)
    assert.equal(v.error, 'store-corrupt')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

// Pocket Cockpit (v0.3 Phase 1): devices carry capabilities; legacy devices
// (no capabilities field) migrate to the default files+cockpit+approval set.
test('device capability: newly paired device gets files+cockpit+approval', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const d = await pairDevice(code, 'phone', f)
    const v = await verifyDevice(d.deviceId, d.credential, f)
    assert.equal(v.ok, true)
    assert.deepEqual(v.device.capabilities, ['files', 'cockpit', 'approval'])
    assert.equal(deviceHasCapability(v.device, 'cockpit'), true)
    assert.equal(deviceHasCapability(v.device, 'approval'), true)
    // narrowing still gates correctly
    assert.equal(deviceHasCapability({ capabilities: ['files'] }, 'cockpit'), false)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('device capability: legacy device (no capabilities field) gets all defaults', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    const code = await ensurePairingCode(f)
    const d = await pairDevice(code, 'phone', f)
    // strip the capabilities field to simulate a pre-cockpit device
    const raw = JSON.parse(await fsp.readFile(f, 'utf8'))
    delete raw.devices[0].capabilities
    await fsp.writeFile(f, JSON.stringify(raw), 'utf8')
    const v = await verifyDevice(d.deviceId, d.credential, f)
    assert.equal(v.ok, true)
    assert.deepEqual(v.device.capabilities, ['files', 'cockpit', 'approval'])
    assert.equal(deviceHasCapability(v.device, 'cockpit'), true)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})
