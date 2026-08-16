// cockpit/away.js — Away Mode state (v0.3 Phase 1).
//
// Product state, deliberately SEPARATE from remfs-security.json: security
// state (pairing/credentials/revocation) and product state (awaySince) must
// not share a store. The away state lives in the project's own DSH profile
// state directory (default ~/.dsh/profiles/web/pocket-away.json).
//
// Pure Node + fs/promises; unit-testable with temp files.
//
// State shape (see contract.js normalizeAwayState):
//   { "away": true, "awaySince": "2026-08-16T15:30:00+09:00" }
//   { "away": false, "awaySince": null }
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { normalizeAwayState } from './contract.js'

/** Default away-state file (project profile state dir, NOT the security store). */
export function defaultAwayFile() {
  return path.join(os.homedir(), '.dsh', 'profiles', 'web', 'pocket-away.json')
}

/** Read the current away state; missing/corrupt file → not away (fail closed,
 *  never invent an awaySince). */
export async function loadAwayState(file = defaultAwayFile()) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { away: false, awaySince: null }
  }
  try {
    return normalizeAwayState(JSON.parse(raw))
  } catch {
    return { away: false, awaySince: null }
  }
}

/** Atomically persist away state (tmp + rename, same volume). */
async function saveAwayState(file, state) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, file)
}

/** Enter Away Mode: records `now` (Date or ISO/ms) as awaySince. */
export async function startAway(file = defaultAwayFile(), now = new Date()) {
  const since = now instanceof Date ? now.toISOString() : String(now)
  const state = { away: true, awaySince: since }
  await saveAwayState(file, state)
  return state
}

/** Exit Away Mode: clears awaySince. */
export async function stopAway(file = defaultAwayFile()) {
  const state = { away: false, awaySince: null }
  await saveAwayState(file, state)
  return state
}
