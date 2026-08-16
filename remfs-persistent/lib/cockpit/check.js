// cockpit/check.js — automatic "since last check" anchor (v0.3, C-老师 design
// §10, §20-P7).
//
// The cockpit records when it was last viewed/checked AUTOMATICALLY, so the
// delta has a default attention boundary ("Since your last check") without the
// user having to manually Start Away. Away Mode stays as an optional explicit
// anchor ("Since you left"). State lives in the project profile state dir,
// separate from remfs-security.json, mirroring away.js (atomic write).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { normalizeLastCheckState } from './contract.js'

/** Default last-check state file (project profile state dir). */
export function defaultCheckFile() {
  return path.join(os.homedir(), '.dsh', 'profiles', 'web', 'pocket-check.json')
}

/** Read the current last-check state; missing/corrupt file → zeros (fail closed). */
export async function loadLastCheckState(file = defaultCheckFile()) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { lastCockpitViewedAt: 0, lastCheckAt: 0 }
  }
  try {
    return normalizeLastCheckState(JSON.parse(raw))
  } catch {
    return { lastCockpitViewedAt: 0, lastCheckAt: 0 }
  }
}

/** Atomically persist last-check state (tmp + rename, same volume). */
async function saveCheckState(file, state) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

/**
 * Record a cockpit check/view: updates BOTH anchors to now.
 * @param {Date|number} [now] - default Date.now().
 */
export async function markChecked(file = defaultCheckFile(), now = Date.now()) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  const state = { lastCockpitViewedAt: t, lastCheckAt: t }
  await saveCheckState(file, state)
  return state
}

/**
 * Touch only the VIEW anchor (the client opened the cockpit but the check is
 * implicit): used when the client signals "cockpit opened" without a full
 * check round-trip. Kept for forward use; Phase 1 uses markChecked.
 */
export async function markViewed(file = defaultCheckFile(), now = Date.now()) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  const prev = await loadLastCheckState(file)
  const state = { lastCockpitViewedAt: t, lastCheckAt: prev.lastCheckAt }
  await saveCheckState(file, state)
  return state
}
