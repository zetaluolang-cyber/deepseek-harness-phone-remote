// scripts/demo-presence.js — synthesize demo sessions to test the floating
// ball / Task Board states (RUNNING / FAILED / DISCONNECTED) with REAL data
// flow: the host's presence service aggregates whatever session-query sees,
// and session-query indexes the persisted sessions dir at startup.
//
// Usage:
//   node scripts/demo-presence.js --add     # write 3 demo sessions
//   node scripts/demo-presence.js --clean   # remove them again
//
// After --add, restart the harness so the session index picks the demo
// sessions up, then open the Orb / Task Board in the browser. The demo
// sessions are clearly named demo-presence-*; --clean removes exactly those
// (never any real session).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { constants, zstdCompressSync } from 'node:zlib'

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const WORKSPACE_DIR = '--C-Users-zeta-Documents--'
const DEMO_IDS = ['demo-presence-running', 'demo-presence-failed', 'demo-presence-disconnected']

function frame(lines) {
  return zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), CHECKSUM)
}

function sessionLog(header, events) {
  return Buffer.concat([frame([JSON.stringify(header)]), frame(events.map((e) => JSON.stringify(e)))])
}

const ev = (type, data, time) => ({ seq: 0, type, time, data })

function buildSessions() {
  const now = Date.now()
  const min = 60 * 1000
  return [
    {
      id: 'demo-presence-running',
      log: sessionLog(
        { type: 'session', id: 'demo-presence-running', createdAt: now - 2 * min },
        [
          ev('turn/start', { turn: 1 }, now - 2 * min),
          ev('tool/result', { name: 'bash', message: { role: 'tool', content: 'ok' } }, now - 20000),
          ev('session/title', { title: 'Demo: Running task (fresh progress)' }, now - 15000),
        ],
      ),
    },
    {
      id: 'demo-presence-failed',
      log: sessionLog(
        { type: 'session', id: 'demo-presence-failed', createdAt: now - 12 * min },
        [
          ev('turn/start', { turn: 1 }, now - 12 * min),
          ev('tool/result', { name: 'bash', message: { role: 'tool', content: 'ok' } }, now - 11 * min),
          ev('turn/end', { turn: 1, reason: { kind: 'error' } }, now - 10 * min),
          // system stays alive after the failure (plain activity, not progress)
          ev('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'text', text: 'x' } }, now - 30000),
          ev('session/title', { title: 'Demo: Failed task (closed error turn)' }, now - 30000),
        ],
      ),
    },
    {
      id: 'demo-presence-disconnected',
      log: sessionLog(
        { type: 'session', id: 'demo-presence-disconnected', createdAt: now - 6 * min },
        [
          ev('turn/start', { turn: 1 }, now - 6 * min),
          ev('tool/result', { name: 'bash', message: { role: 'tool', content: 'ok' } }, now - 5 * min),
          ev('session/title', { title: 'Demo: Disconnected task (no heartbeat)' }, now - 5 * min),
        ],
      ),
    },
  ]
}

function sessionsRoot() {
  return path.join(os.homedir(), '.dsh', 'sessions')
}

function demoDir(wsRoot, id) {
  return path.join(wsRoot, id)
}

export function addDemos() {
  const root = sessionsRoot()
  const wsRoot = path.join(root, WORKSPACE_DIR)
  fs.mkdirSync(wsRoot, { recursive: true })
  let count = 0
  for (const s of buildSessions()) {
    const dir = demoDir(wsRoot, s.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), s.log)
    count += 1
  }
  return count
}

export function cleanDemos() {
  const wsRoot = path.join(sessionsRoot(), WORKSPACE_DIR)
  let count = 0
  for (const id of DEMO_IDS) {
    const dir = path.join(wsRoot, id)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      count += 1
    }
  }
  return count
}

const args = process.argv.slice(2)
if (args.includes('--add')) {
  const n = addDemos()
  console.log('wrote ' + n + ' demo sessions into ' + sessionsRoot())
  console.log('restart the harness (schtasks /run /tn dsh_restart) so session-query indexes them.')
} else if (args.includes('--clean')) {
  const n = cleanDemos()
  console.log('removed ' + n + ' demo sessions (real sessions untouched)')
} else {
  console.log('usage: node scripts/demo-presence.js --add | --clean')
}
