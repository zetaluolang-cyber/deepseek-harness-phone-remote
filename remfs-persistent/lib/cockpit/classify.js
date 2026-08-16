// cockpit/classify.js — session status classification (v0.3 Phase 1).
//
// Pure Node: consumes DSH session event records (the lightweight
// SessionEventRecord shape: { seq, type, time }) plus a couple of hints
// (live agent presence) and returns one of STATUS. No Cordis, no DOM — fully
// unit-testable with synthetic event streams.
//
// Classification rules (Phase 1):
//   1. NEEDS_ATTENTION — the agent is BLOCKED waiting on the human. Phase 1
//      trigger: an `approval/asked` event with no matching `approval/decided`
//      (a pending approval the agent cannot proceed past). Priority over
//      RUNNING: a blocked agent is more important than a busy one.
//   2. RUNNING — an open turn (`turn/start` without a matching `turn/end`)
//      and/or a live agent with recent activity.
//   3. FAILED — the LAST turn ended with reason.kind === 'error' and no newer
//      turn is open.
//   4. FINISHED — the LAST turn ended 'completed' and no newer turn is open.
//   5. IDLE — everything else (no turns yet, or the last turn ended
//      aborted/blocked/interrupted/max-tokens and nothing is running).
//
// A session with NO events is IDLE. A session whose last turn/end is
// 'aborted'/'blocked'/'interrupted'/'max-tokens' with no open turn is IDLE
// (not FAILED, not FINISHED) — Phase 1 keeps the vocabulary conservative.
import { STATUS } from './contract.js'

/** Event types that carry the turn boundary. */
const TURN_START = 'turn/start'
const TURN_END = 'turn/end'
const APPROVAL_ASKED = 'approval/asked'
const APPROVAL_DECIDED = 'approval/decided'

/**
 * Classify one session.
 * @param {Array<Object>} events - session events (any order-able records that
 *   expose `type`; prefer ascending seq). May be the lightweight record list.
 * @param {Object} [hints] - { liveAgent?: boolean } — true when a live agent
 *   currently drives this session (host cross-checks ctx.agents).
 * @returns {string} one of STATUS.
 */
export function classifySession(events, hints = {}) {
  const list = Array.isArray(events) ? events : []
  if (list.length === 0) {
    // No events at all: only a live agent could make this RUNNING.
    return hints.liveAgent ? STATUS.RUNNING : STATUS.IDLE
  }

  // Pending approval = blocked agent = NEEDS_ATTENTION (highest priority).
  if (hasPendingApproval(list)) return STATUS.NEEDS_ATTENTION

  const openTurn = hasOpenTurn(list)

  if (openTurn) return STATUS.RUNNING
  // A live agent with an open turn is RUNNING; without one, still RUNNING is
  // the safe read while the agent exists (it may be mid-dispatch).
  if (hints.liveAgent) return STATUS.RUNNING

  const lastEndReason = lastTurnEndReason(list)
  if (lastEndReason === 'error') return STATUS.FAILED
  if (lastEndReason === 'completed' && lastTurnHasToolError(list)) return STATUS.FAILED
  if (lastEndReason === 'completed') return STATUS.FINISHED
  return STATUS.IDLE
}

/** True when the LATEST completed turn contained a tool execution failure
 *  (tool/result.error). Real DSH data shows tool failures do NOT end the turn
 *  with reason.kind='error' — the turn completes normally while carrying the
 *  error, so "execution actually failed" must also check tool results
 *  (C-老师 design §5.4). A later successful turn means the failure was
 *  resolved and the session is FINISHED, not FAILED. */
export function lastTurnHasToolError(events) {
  let inLastTurn = false
  let sawToolError = false
  for (const e of events) {
    if (e.type === TURN_START) {
      inLastTurn = true
      sawToolError = false
      continue
    }
    if (e.type === TURN_END) {
      inLastTurn = false
      continue
    }
    if (!inLastTurn) continue
    if (e.type === 'tool/result' && ((e.data && e.data.error) || e.error)) {
      sawToolError = true
    }
  }
  return sawToolError
}

/** True when an `approval/asked` exists without a matching `approval/decided`. */
export function hasPendingApproval(events) {
  const asked = new Set()
  const decided = new Set()
  for (const e of events) {
    if (e.type === APPROVAL_ASKED) {
      const id = idOf(e)
      if (id) asked.add(id)
    } else if (e.type === APPROVAL_DECIDED) {
      const id = idOf(e)
      if (id) decided.add(id)
    }
  }
  for (const id of asked) {
    if (!decided.has(id)) return true
  }
  return false
}

function idOf(e) {
  // DSH approval/asked: { id, toolName, ... }; approval/decided: { id, outcome }
  if (e.data && e.data.id != null) return String(e.data.id)
  if (e.id != null) return String(e.id)
  return null
}

/** True when the latest turn/start has no later turn/end. */
export function hasOpenTurn(events) {
  let open = false
  for (const e of events) {
    if (e.type === TURN_START) open = true
    else if (e.type === TURN_END) open = false
  }
  return open
}

/** reason.kind of the LAST turn/end, or null when the session never ended a turn. */
export function lastTurnEndReason(events) {
  let reason = null
  for (const e of events) {
    if (e.type !== TURN_END) continue
    const kind = e.data && e.data.reason && e.data.reason.kind
      ? String(e.data.reason.kind)
      : (e.reason && e.reason.kind ? String(e.reason.kind) : 'completed')
    reason = kind
  }
  return reason
}
