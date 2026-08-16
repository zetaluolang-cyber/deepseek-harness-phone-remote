// cockpit/delta.js — "what changed while you were away" counters (v0.3
// Phase 1, structured-only — NO LLM summary yet).
//
// Pure Node: consumes DSH session events with timestamps and counts a small
// stable delta since `awaySince` (ms epoch). Phase 1 keeps the delta to basic
// counters derived from reliable event types only — never DOM scraping, never
// a filesystem watcher:
//   filesChanged  — tool/call events whose tool name is a file-mutating tool
//                   (write / edit / fs-write / fs-edit / str-replace-editor)
//   toolCalls     — every tool/call event
//   errors        — tool/result with an `error` field, or turn/end reason 'error'
//   approvals     — approval/asked events (requested while you were away)
//   testRuns      — tool/call events whose tool name or arguments mention tests
//                   (node --test, pytest, ...) — best-effort, may undercount
//
// If a class of information cannot be derived reliably, Phase 1 omits it
// rather than guessing (documented limitations).

/** File-mutating tool names (best-effort Phase 1 set). */
const FILE_MUTATION_TOOLS = new Set([
  'write', 'edit', 'str-replace-editor',
  'fs/write', 'fs/edit', 'fs/write_text', 'fs/edit_text',
  'tool:fs/write', 'tool:fs/edit',
])

/** Tool names that commonly run tests (best-effort). */
const TEST_TOOL_RE = /test|pytest|jest|vitest|mocha|rspec/i

/**
 * Compute the away delta for one session.
 * @param {Array<Object>} events - session events with `type` and `time` (ms).
 * @param {number} [sinceMs] - ms epoch; 0/undefined counts the whole log.
 * @returns {{ filesChanged: number, toolCalls: number, errors: number,
 *   approvals: number, testRuns: number, testsPassed: number,
 *   agentFinished: boolean, hasEvents: boolean }}
 */
export function computeDelta(events, sinceMs = 0) {
  const out = { filesChanged: 0, toolCalls: 0, errors: 0, approvals: 0, testRuns: 0, testsPassed: 0, agentFinished: false, hasEvents: false }
  const list = Array.isArray(events) ? events : []
  for (const e of list) {
    if (!e || typeof e.type !== 'string') continue
    if (sinceMs > 0 && Number(e.time) < sinceMs) continue
    out.hasEvents = true
    switch (e.type) {
      case 'tool/call': {
        out.toolCalls += 1
        const name = String((e.data && e.data.name) || (e.name) || '')
        const args = String((e.data && e.data.arguments) || (e.arguments) || '')
        if (FILE_MUTATION_TOOLS.has(name) || /(^|\/)(write|edit)(_|$)/.test(name)) {
          out.filesChanged += 1
        }
        if (TEST_TOOL_RE.test(name) || TEST_TOOL_RE.test(args)) out.testRuns += 1
        break
      }
      case 'tool/result': {
        if ((e.data && e.data.error) || e.error) out.errors += 1
        // tests passed: a successful tool/result whose text/meta reports a
        // passing test run (best-effort; may undercount, never overcount).
        // Accepts both "38 tests passed" / "38 passed" and {"passed":38}.
        if (!((e.data && e.data.error) || e.error)) {
          const text = String((e.data && e.data.message) || (e.message) || '')
          const meta = JSON.stringify((e.data && e.data.meta) || e.meta || '')
          const hay = text + ' ' + meta
          const m = /(\d+)\s*(tests?\s+)?passed/i.exec(hay) || /passed["']?\s*[:=]\s*(\d+)/i.exec(hay)
          if (m) out.testsPassed += parseInt(m[1] || m[2], 10) || 0
        }
        break
      }
      case 'turn/end': {
        const kind = e.data && e.data.reason && e.data.reason.kind
          ? String(e.data.reason.kind)
          : (e.reason && e.reason.kind ? String(e.reason.kind) : '')
        if (kind === 'error') out.errors += 1
        if (kind === 'completed') out.agentFinished = true
        break
      }
      case 'approval/asked': {
        out.approvals += 1
        break
      }
      default:
        break
    }
  }
  return out
}
