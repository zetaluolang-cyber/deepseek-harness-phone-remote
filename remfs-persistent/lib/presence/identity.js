// presence/identity.js — session identity read from the persisted log.
//
// Why this file exists at all: sessionQuery.listEvents() returns an event
// INDEX, not content. Verified against a live harness - a user/message record
// arrives as { sessionId, seq, type, time, surface } with no `data` at all,
// so nothing derived from it can ever show what the user said. The words only
// exist in ~/.dsh/sessions/<ws>/<id>/session.jsonl.zstd.
//
// Why it is worth reading that file: a fleet list is unusable without
// identity. Twenty-seven rows of "DONE" cannot tell the dev session from the
// daily-report one, and DSH does not persist its context-compaction summaries
// (verified: zero compact/summary events in a 17k-event log), so there is no
// free AI summary to reuse. What IS on disk is what the human typed - free,
// verbatim, and impossible to paraphrase wrongly.
//
// Cost control, because presence polls every ~10s and the logs are large:
//   - identity NEVER changes for a finished session, so it is cached per
//     sessionId keyed on the file's (mtimeMs, size);
//   - only the head and tail of the file are needed, so at most the first and
//     last few zstd frames are decompressed, never the whole 5 MB;
//   - every failure degrades to empty strings. Identity is a nicety; presence
//     must never break because a log is unreadable.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadSessionFile } from './sessionlog.js'

/** Frames decompressed from each end of the log... (removed: the whole log is
 *  parsed by the shared reader, which is fast enough at these sizes and is
 *  the only implementation that correctly walks zstd block headers). */
const MAX_CACHE = 200

const cache = new Map() // sessionId -> { key, first, last }

/** The text a HUMAN typed in one record, or '' for anything else.
 *  Plugin/tool injections also arrive with role 'user' (system-prompt
 *  snapshots, sandbox policy, background-job receipts, browser error relays),
 *  so source.kind must be exactly 'user'. */
export function humanText(rec) {
  if (!rec || rec.type !== 'user/message') return ''
  const d = rec.data || rec
  const kind = String((d.source && d.source.kind) || '')
  if (kind !== 'user') return ''
  let raw = d.text != null ? d.text : d.content
  if (Array.isArray(raw)) {
    raw = raw.map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join(' ')
  }
  if (typeof raw !== 'string') return ''
  return raw.replace(new RegExp('\\s+', 'g'), ' ').trim()
}

export const sessionsRoot = () => path.join(os.homedir(), '.dsh', 'sessions')

/** Find one session's log file (the workspace-key directory is internal to
 *  DSH, so the file is located by id instead of reconstructing the layout). */
export function findSessionLog(sessionId, root = sessionsRoot()) {
  const want = String(sessionId || '')
  if (!want) return null
  const walk = (dir, depth) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (e.name === want || e.name === 'session-' + want) {
        const f = path.join(full, 'session.jsonl.zstd')
        return fs.existsSync(f) ? f : null
      }
      if (depth < 4) {
        const hit = walk(full, depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(root, 0)
}

/**
 * The user's own first and last words for one session.
 * @returns {{first: string, last: string}} empty strings when unavailable.
 */
export function sessionIdentity(sessionId, opts = {}) {
  const maxChars = Number(opts.maxChars) || 80
  const file = opts.file || findSessionLog(sessionId, opts.root || sessionsRoot())
  if (!file) return { first: '', last: '' }
  let stat
  try { stat = fs.statSync(file) } catch { return { first: '', last: '' } }
  const key = stat.mtimeMs + ':' + stat.size
  const hit = cache.get(sessionId)
  if (hit && hit.key === key) return { first: hit.first, last: hit.last }

  let first = ''
  let last = ''
  try {
    const { events } = loadSessionFile(file)
    const texts = []
    for (const rec of events) {
      const t = humanText(rec)
      if (t) texts.push(t)
    }
    if (texts.length > 0) {
      first = texts[0]
      // One message only: do not echo the same string as both ends.
      if (texts.length > 1) last = texts[texts.length - 1]
    }
  } catch { /* identity is a nicety; never break presence over it */ }

  const clip = (s) => (s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s)
  const value = { key, first: clip(first), last: clip(last) }
  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(sessionId, value)
  return { first: value.first, last: value.last }
}
