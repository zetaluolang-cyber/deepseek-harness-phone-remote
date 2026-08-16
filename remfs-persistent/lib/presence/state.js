// presence/state.js — presence state machine (Agent Presence 设计书 §4, §7,
// §21) + deterministic STALE heuristic.
//
// State resolution order (§7) — first match wins:
//   1. system heartbeat lost            → DISCONNECTED
//   2. approval/question pending        → NEEDS_USER
//   3. terminal failure                 → FAILED
//   4. task completed                   → DONE
//   5. agent running AND progress stale → STALE
//   6. agent running                    → RUNNING
//   7. otherwise                        → IDLE
//
// STALE is NEVER asserted as "deadlock" — only "no meaningful progress
// observed for >= threshold" (§4.3, §42). All reasons are observable facts.
import { STATE } from './contract.js'
import { isSystemAlive, isProgressStale } from './heartbeat.js'

/**
 * Resolve one session's presence state.
 * @param {Object} f - facts:
 *   { systemHeartbeatAt, progressHeartbeatAt, pendingApproval: boolean,
 *     terminalFailure: boolean, completed: boolean, agentRunning: boolean,
 *     now, systemTtlMs, staleMs }
 * @param {Array<string>} [staleReasons] - mutable array to append explainable
 *   facts when STALE (§42).
 * @returns {string} one of STATE.
 */
export function resolveState(f, staleReasons = []) {
  const now = f.now != null ? f.now : Date.now()
  const alive = isSystemAlive(f.systemHeartbeatAt, now, f.systemTtlMs)

  if (!alive) return STATE.DISCONNECTED
  if (f.pendingApproval) return STATE.NEEDS_USER
  if (f.terminalFailure) return STATE.FAILED
  if (f.completed) return STATE.DONE
  if (!f.agentRunning) return STATE.IDLE
  if (isProgressStale(f.progressHeartbeatAt, now, f.staleMs)) {
    if (staleReasons) {
      if (!f.progressHeartbeatAt) staleReasons.push('no meaningful progress observed since the session began')
      else {
        const mins = Math.max(1, Math.floor((now - f.progressHeartbeatAt) / 60000))
        staleReasons.push('no meaningful progress for ' + mins + 'm')
      }
      if (f.observedErrorCount > 0) staleReasons.push((f.observedErrorCount || 0) + ' error(s) observed in this window')
    }
    return STATE.STALE
  }
  return STATE.RUNNING
}

/**
 * Lifecycle guard (design §21): given the previous state and the resolved
 * state, return the state the task SHOULD be in. Keeps transitions legal:
 *   STALE → RUNNING (recovered), RUNNING → STALE, → NEEDS_USER, → FAILED,
 *   → DONE, NEEDS_USER → RUNNING, etc. Illegal jumps (e.g. DONE → RUNNING
 *   without a new task) are clamped.
 * Phase A: we do not yet track task identity across completions, so the guard
 * accepts all forward transitions and only prevents DONE/FAILED regressing to
 * RUNNING on the SAME task (a fresh task would be a new taskId upstream).
 * @param {string} prev - previous STATE.
 * @param {string} next - resolved STATE.
 * @returns {string} the state to report.
 */
export function transition(prev, next) {
  if (!prev) return next
  if (prev === next) return next
  // Once a task is DONE or FAILED, it must not silently go back to RUNNING on
  // the same identity (design §21 lifecycle: terminal states only leave via a
  // new task). Phase A keeps this conservative; recovery from STALE→RUNNING
  // is allowed (that is the designed recovery path).
  if ((prev === STATE.DONE || prev === STATE.FAILED) && next === STATE.RUNNING) {
    return prev
  }
  if (prev === STATE.STALE && next === STATE.RUNNING) return next // recovery
  return next
}
