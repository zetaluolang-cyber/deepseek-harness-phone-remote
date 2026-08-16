// presence/summary.js — progress summaries (Agent Presence 设计书 §9, §42).
//
// Summary must answer "where is the task?" (PROGRESS), not "what command ran
// last?" (ACTIVITY). E.g. "Security changes are complete; integration tests
// are running." — not "Executed node --test".
//
// STALE explanations are always observable facts (design §42), never "the AI
// thinks the AI is stuck".
import { STATE, PROGRESS_KIND } from './contract.js'

/** Map a progress kind to a human phrase. */
const PROGRESS_PHRASE = {
  [PROGRESS_KIND.PLAN_STEP]: 'a new step began',
  [PROGRESS_KIND.TOOL_SUCCESS]: 'a tool completed successfully',
  [PROGRESS_KIND.FILE_DIFF]: 'files changed',
  [PROGRESS_KIND.TEST_CHANGE]: 'test results changed',
  [PROGRESS_KIND.ERROR_CHANGE]: 'an error state changed',
  [PROGRESS_KIND.APPROVAL_RESOLVED]: 'an approval was resolved',
  [PROGRESS_KIND.QUESTION_RESOLVED]: 'a question was resolved',
  [PROGRESS_KIND.SUBAGENT_DONE]: 'a subagent finished',
  [PROGRESS_KIND.TASK_COMPLETE]: 'the task completed',
}

/**
 * Build a one-line PROGRESS summary from observed events.
 * @param {Array<Object>} events - session events ascending.
 * @param {string} state - resolved STATE.
 * @returns {string} a progress-oriented summary (empty when nothing useful).
 */
export function summarize(events, state) {
  const list = Array.isArray(events) ? events : []
  if (list.length === 0) return ''

  // Walk backwards to the last few meaningful progress events.
  const recent = []
  for (let i = list.length - 1; i >= 0 && recent.length < 3; i--) {
    const e = list[i]
    if (!e) continue
    const phrase = progressPhraseOf(e)
    if (phrase) recent.push({ phrase, time: Number(e.time) || 0, type: e.type })
  }
  if (recent.length === 0) {
    // No progress events: describe the terminal/blocked state plainly.
    if (state === STATE.STALE) return 'Agent is responsive, but no meaningful progress has been observed recently.'
    if (state === STATE.NEEDS_USER) return 'Agent is waiting for you.'
    if (state === STATE.FAILED) return 'Agent stopped due to an error.'
    if (state === STATE.DONE) return 'Task completed.'
    return ''
  }

  // Build: first phrase + ("; then" ...) + final clause for terminal states.
  const phrases = recent.map((r) => r.phrase).reverse()
  let summary = phrases.join('; ')
  if (state === STATE.DONE) summary += ' — task complete.'
  if (state === STATE.FAILED) summary += ' — then stopped with an error.'
  if (state === STATE.NEEDS_USER) summary += ' — now waiting for you.'
  if (state === STATE.STALE) summary += ' — no further progress since.'
  return summary
}

function progressPhraseOf(e) {
  if (!e || typeof e.type !== 'string') return null
  switch (e.type) {
    case 'step/start':
    case 'todo/write':
      return PROGRESS_PHRASE[PROGRESS_KIND.PLAN_STEP]
    case 'tool/result': {
      if ((e.data && e.data.error) || e.error) return null // errors aren't progress
      return PROGRESS_PHRASE[PROGRESS_KIND.TOOL_SUCCESS]
    }
    case 'approval/decided':
      return PROGRESS_PHRASE[PROGRESS_KIND.APPROVAL_RESOLVED]
    case 'tool-workflow/agent-end':
    case 'subagent/descriptor':
      return PROGRESS_PHRASE[PROGRESS_KIND.SUBAGENT_DONE]
    case 'turn/end': {
      const kind = e.data && e.data.reason && e.data.reason.kind
      if (kind === 'completed') return PROGRESS_PHRASE[PROGRESS_KIND.TASK_COMPLETE]
      return null
    }
    default:
      return null
  }
}

/**
 * Build explainable STALE reasons from observable facts (design §42).
 * @param {Object} facts - { progressMins, errorCount, repeatedError: boolean,
 *   fileChanges: number, taskTransitions: number }
 * @returns {string[]} bullet-style facts.
 */
export function staleReasonLines(facts) {
  const lines = []
  const f = facts || {}
  if (f.progressMins) lines.push('No meaningful progress for ' + f.progressMins + 'm.')
  if (f.errorCount > 0) {
    if (f.repeatedError) lines.push('The same failure has repeated.')
    else lines.push(f.errorCount + ' error(s) observed.')
  }
  if (f.fileChanges === 0) lines.push('No file changes observed.')
  if (f.taskTransitions === 0) lines.push('No task-state transition observed.')
  if (lines.length === 0) lines.push('No meaningful progress has been observed recently.')
  return lines
}
