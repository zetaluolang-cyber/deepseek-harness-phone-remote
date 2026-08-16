// scripts/dump-session.js — export a REAL session log as readable dialogue.
//
// The GUI compacts long conversations (checkpoint/compaction), so older
// messages look "gone" after a restart. Nothing is lost: every event lives
// in ~/.dsh/sessions/<workspace>/<sessionId>/session.jsonl.zstd. This tool
// decompresses that file (same frame scanner as dogfood-board.js) and prints
// the conversation as readable text — the full history, compaction-free.
//
// Usage:
//   node scripts/dump-session.js --session <sessionId> [--sessions <dir>]
//                                 [--max <n>] [--json]
//   node scripts/dump-session.js --list            (list session ids)
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import { loadSessionsDir, loadSessionFile } from './dogfood-board.js'

/** Extract a readable dialogue from one session's events.
 *  @param {Array} events - event records from loadSessionFile.
 *  @returns {Array<{time:number|null, role:string, text:string}>} */
export function extractDialogue(events) {
  const out = []
  for (const e of events) {
    const t = Number(e.time) || null
    if (e.type === 'user/message') {
      const text = e.data && (e.data.text ?? e.data.content)
      if (typeof text === 'string' && text.trim()) {
        out.push({ time: t, role: 'user', text: text.trim() })
      }
    } else if (e.type === 'assistant/message') {
      const msg = e.data && e.data.message
      if (!msg) continue
      const parts = []
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
        else if (c && c.type === 'tool-call' && c.name) {
          parts.push('[tool: ' + c.name + ']')
        }
      }
      if (parts.length > 0) out.push({ time: t, role: 'assistant', text: parts.join('\n') })
    } else if (e.type === 'tool/result') {
      const d = e.data || {}
      const name = String(d.name || e.name || 'tool')
      const ok = !(d.error || e.error)
      const brief = ok ? 'ok' : 'error'
      out.push({ time: t, role: 'tool', text: '[' + name + ' → ' + brief + ']' })
    } else if (e.type === 'session/title') {
      const title = e.data && e.data.title
      if (title) out.push({ time: t, role: 'meta', text: 'title: ' + title })
    }
  }
  return out
}

/** Render a dialogue as plain readable text. */
export function renderDialogue(lines) {
  const parts = []
  for (const l of lines) {
    const ts = l.time ? new Date(l.time).toISOString().replace('T', ' ').slice(0, 19) + ' ' : ''
    const label = { user: 'YOU', assistant: 'AGENT', tool: 'TOOL', meta: 'META' }[l.role] || l.role
    const body = l.text.split('\n').map((s) => '  ' + s).join('\n')
    parts.push(ts + label + '\n' + body)
  }
  return parts.join('\n\n')
}

export function main(argv) {
  const args = argv || process.argv.slice(2)
  let sessionsDir = path.join(os.homedir(), '.dsh', 'sessions')
  let sessionId = ''
  let json = false
  let max = 500
  let listOnly = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--session') sessionId = args[++i]
    else if (a === '--sessions') sessionsDir = args[++i]
    else if (a === '--max') max = Number(args[++i])
    else if (a === '--json') json = true
    else if (a === '--list') listOnly = true
  }
  const sessions = loadSessionsDir(sessionsDir, max)
  if (listOnly) {
    for (const s of sessions) console.log(s.sessionId + '\t' + s.workspaceDir)
    return
  }
  const target = sessions.find((s) => s.sessionId === sessionId)
  if (!target) {
    console.error('session not found: ' + sessionId + ' (use --list to see ids)')
    process.exitCode = 1
    return
  }
  const { events, header } = loadSessionFile(target.file)
  const title = header ? header.id : sessionId
  const dialogue = extractDialogue(events)
  if (json) {
    console.log(JSON.stringify({ sessionId, file: target.file, title, messages: dialogue }, null, 2))
  } else {
    console.log('# ' + sessionId + '  (' + target.file + ')')
    console.log('# messages: ' + dialogue.length + '  events: ' + events.length)
    console.log('')
    console.log(renderDialogue(dialogue))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
