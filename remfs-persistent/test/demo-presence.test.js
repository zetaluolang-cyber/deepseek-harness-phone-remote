// Demo-presence tool behavior tests (stability closure).
// The script writes demo sessions into the LIVE profile by default; every
// test here pins REMF_DEMO_SESSIONS_ROOT to a fresh temp dir so the live
// profile is never touched.
// Covered guardrails:
//   - --add is idempotent and cleans stale demo dirs FIRST (clean-before-add)
//   - the persisted header cwd is FIXED to WORKSPACE_CWD (never process.cwd(),
//     which made the header location-dependent and corrupted sessions)
//   - --clean removes ONLY demo-presence-* dirs, never real sessions
// Run: node --test test/demo-presence.test.js
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { addDemos, cleanDemos } from '../scripts/demo-presence.js'

// Must mirror scripts/demo-presence.js WORKSPACE_CWD exactly: the header cwd
// is the real workspace path the sessions dir key encodes.
const WORKSPACE_CWD = 'C:\\Users\\zeta\\Documents'
const WS_DIR = '--C-Users-zeta-Documents--'
const DEMO_IDS = ['demo-presence-running', 'demo-presence-failed', 'demo-presence-disconnected']

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'remfs-demo-'))
  process.env.REMF_DEMO_SESSIONS_ROOT = root
})

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  delete process.env.REMF_DEMO_SESSIONS_ROOT
})

const wsRoot = () => path.join(root, WS_DIR)
const demoDirs = () => fs.readdirSync(wsRoot()).filter((d) => d.startsWith('demo-presence-'))
const logPath = (id) => path.join(wsRoot(), id, 'session.jsonl.zstd')

test('demo: --add writes 3 demo sessions and is idempotent (clean-before-add)', () => {
  assert.equal(addDemos('all'), 3)
  assert.deepEqual(demoDirs().sort(), DEMO_IDS.slice().sort())
  for (const id of DEMO_IDS) {
    assert.equal(fs.existsSync(logPath(id)), true, id + ' must carry session.jsonl.zstd')
  }

  // Second --add must not duplicate anything (still exactly the 3 demo dirs).
  assert.equal(addDemos('all'), 3)
  assert.equal(demoDirs().length, 3)

  // A STALE demo dir from an older header format must be wiped BEFORE the
  // fresh write (clean-before-add): leftover garbage must never survive.
  const stale = path.join(wsRoot(), 'demo-presence-running')
  fs.writeFileSync(path.join(stale, 'stale-marker'), 'old format leftovers')
  assert.equal(addDemos('all'), 3)
  assert.equal(fs.existsSync(path.join(stale, 'stale-marker')), false, 'stale files must be removed first')
  assert.equal(fs.existsSync(logPath('demo-presence-running')), true)
})

test('demo: header cwd is fixed to WORKSPACE_CWD (location-independent)', () => {
  addDemos('all')
  const buf = fs.readFileSync(logPath('demo-presence-running'))
  const header = JSON.parse(zstdDecompressSync(buf).toString('utf8'))
  assert.equal(header.type, 'session')
  assert.equal(header.cwd, WORKSPACE_CWD,
    'header cwd must be the fixed workspace path, not process.cwd() of wherever the test runs')
  assert.notEqual(header.cwd, process.cwd(), 'a location-dependent cwd would corrupt the session index')
  // The required persisted-header fields (persistence.listSnapshots strictness).
  assert.equal(header.version, 0)
  assert.equal(header.delegationDepth, 0)
  assert.equal(header.agentPreset, 'standard')
})

test('demo: --clean removes ONLY demo-presence-* dirs, never real sessions', () => {
  addDemos('all')
  const real = path.join(wsRoot(), 'session-11111111-2222-4333-8444-555555555555')
  fs.mkdirSync(real, { recursive: true })
  fs.writeFileSync(path.join(real, 'session.jsonl.zstd'), 'real session log')
  const unrelated = path.join(wsRoot(), 'unrelated-folder')
  fs.mkdirSync(unrelated, { recursive: true })

  assert.equal(cleanDemos('all'), 3)
  assert.equal(demoDirs().length, 0, 'all demo dirs must be gone')
  assert.equal(fs.existsSync(real), true, 'a real-looking session dir must survive --clean')
  assert.equal(fs.readFileSync(path.join(real, 'session.jsonl.zstd'), 'utf8'), 'real session log')
  assert.equal(fs.existsSync(unrelated), true, 'an unrelated dir must survive --clean')
})

test('demo: per-state filters add/clean only the requested demo', () => {
  cleanDemos('all')
  assert.equal(addDemos('running'), 1)
  assert.equal(fs.existsSync(logPath('demo-presence-running')), true)
  assert.equal(fs.existsSync(logPath('demo-presence-failed')), false)

  addDemos('all')
  assert.equal(cleanDemos('failed'), 1)
  assert.equal(fs.existsSync(logPath('demo-presence-failed')), false)
  assert.equal(fs.existsSync(logPath('demo-presence-running')), true)
})
