// presence/heartbeat.js — dual heartbeat + meaningful-progress determination
// (Agent Presence 设计书 §5, §6).
//
// System heartbeat  = "is the harness/session still reachable?"
// Progress heartbeat = "when did the task last genuinely move forward?"
//
// The SYSTEM heartbeat is ENGINE liveness: the harness process is alive and
// answering presence calls. It is NOT "the session logged an event recently".
// While the engine answers, every listed session stays reachable, so a quiet
// session (agent waiting, NEEDS_USER, DONE, IDLE, even an empty log) must
// never decay to DISCONNECTED just because its log is silent.
// foldHeartbeats() returns the per-session log-activity OBSERVATION;
// effectiveSystemAliveAt() decides the heartbeat the state machine actually
// uses (reachable session vs orphaned per-session loop).
//
// Running ≠ Progressing (§2.1): an agent can be alive, streaming, CPU-busy,
// yet stuck repeating the same tool/error with no new results. Only events
// classified as meaningful progress may advance progressHeartbeatAt.
import { HEARTBEAT_KIND, PROGRESS_KIND } from './contract.js'

/** Default system heartbeat freshness window (ms). Beyond this, DISCONNECTED. */
export const DEFAULT_SYSTEM_TTL_MS = 60 * 1000

/** Fingerprint of a repeated event, used to suppress duplicate progress. */
function fingerprint(e) {
  if (!e) return ''
  if (e.type === 'tool/call') {
    const name = String((e.data && e.data.name) || e.name || '')
    const args = String((e.data && e.data.arguments) || e.arguments || '')
    return 'tool/call:' + name + ':' + args
  }
  if (e.type === 'tool/result') {
    const name = String((e.data && e.data.name) || e.name || '')
    return 'tool/result:' + name + ':' + ((e.data && e.data.error) ? 'err' : 'ok')
  }
  if (e.type === 'user/message' || e.type === 'assistant/message') {
    const text = String((e.data && e.data.content) || e.content || '')
    return e.type + ':' + text.slice(0, 200)
  }
  return e.type + ':' + JSON.stringify(e.data || {}).slice(0, 200)
}

/**
 * Classify ONE event as meaningful progress (or not).
 * @param {Object} e - session event.
 * @param {Object} [seen] - Map<string, number> of prior fingerprints→count, to
 *   suppress repeats (repeated identical tool call / identical error).
 * @returns {{ progress: boolean, kind: string|null, error: boolean }}
 */
export function classifyProgress(e, seen) {
  if (!e || typeof e.type !== 'string') return { progress: false, kind: null, error: false }

  const fp = fingerprint(e)
  const prior = (seen && seen.get(fp)) || 0

  switch (e.type) {
    case 'tool/call': {
      // A tool CALL alone is not progress (it may never run / may fail).
      // Repeats of the identical call are explicitly NOT progress (§6).
      return { progress: false, kind: null, error: false }
    }
    case 'tool/result': {
      const err = (e.data && e.data.error) || e.error
      if (err) {
        // Repeated identical error is NOT progress; a NEW error state is.
        const isRepeat = prior > 0
        if (isRepeat) return { progress: false, kind: null, error: true }
        return { progress: true, kind: PROGRESS_KIND.ERROR_CHANGE, error: true }
      }
      // A tool SUCCESS with a substantive result IS progress, unless it is a
      // byte-identical repeat (same tool, same result shape).
      if (prior > 0) return { progress: false, kind: null, error: false }
      return { progress: true, kind: PROGRESS_KIND.TOOL_SUCCESS, error: false }
    }
    case 'todo/write': {
      // Whole-list snapshot: a change in task statuses is progress.
      return { progress: true, kind: PROGRESS_KIND.PLAN_STEP, error: false }
    }
    case 'step/start':
    case 'step/end': {
      // A new model step = plan/phase moved forward.
      return { progress: true, kind: PROGRESS_KIND.PLAN_STEP, error: false }
    }
    case 'approval/decided': {
      return { progress: true, kind: PROGRESS_KIND.APPROVAL_RESOLVED, error: false }
    }
    case 'approval/asked': {
      // Asking for approval is NOT progress (the agent is blocked). The
      // NEEDS_USER state is driven by the pending-approval detector instead.
      return { progress: false, kind: null, error: false }
    }
    case 'tool-workflow/agent-end':
    case 'subagent/descriptor': {
      return { progress: true, kind: PROGRESS_KIND.SUBAGENT_DONE, error: false }
    }
    case 'turn/end': {
      const kind = e.data && e.data.reason && e.data.reason.kind
        ? String(e.data.reason.kind)
        : ''
      if (kind === 'completed') {
        return { progress: true, kind: PROGRESS_KIND.TASK_COMPLETE, error: false }
      }
      if (kind === 'error') {
        return { progress: false, kind: null, error: true }
      }
      return { progress: false, kind: null, error: false }
    }
    default:
      return { progress: false, kind: null, error: false }
  }
}

/**
 * Fold a batch of events into heartbeat state.
 *
 * The returned `systemHeartbeatAt` is the log-activity OBSERVATION (latest
 * event time, or null for an empty log). It feeds the DTO heartbeat floor and
 * the orphaned-loop check in effectiveSystemAliveAt(). Feeding this raw value
 * to resolveState() as the aliveness fact is the P0 bug fixed here: a quiet
 * but reachable session would decay to DISCONNECTED ~60s after its last event.
 * @param {Array<Object>} events - session events ascending by seq/time.
 * @param {Object} [opts] - { now, seen } — `seen` persists across calls so a
 *   repeat across reconciles is also suppressed.
 * @returns {{ systemHeartbeatAt: number|null, progressHeartbeatAt: number|null,
 *   errorCount: number, lastErrorFingerprint: string|null }}
 */
export function foldHeartbeats(events, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now()
  const seen = opts.seen || new Map()
  let systemHeartbeatAt = null
  let progressHeartbeatAt = null
  let errorCount = 0
  let lastErrorFingerprint = null

  for (const e of Array.isArray(events) ? events : []) {
    // Every recognized session event is log-activity evidence: the agent log
    // is live. This is a per-session OBSERVATION (a floor for the DTO and the
    // orphaned-loop check), NOT the system-aliveness decision. That decision
    // belongs to effectiveSystemAliveAt() with the engine's own alive
    // timestamp.
    if (e && e.type && typeof e.type === 'string') {
      const t = Number(e.time)
      if (Number.isFinite(t) && t > 0 && (systemHeartbeatAt === null || t > systemHeartbeatAt)) {
        systemHeartbeatAt = t
      }
    }
    const cls = classifyProgress(e, seen)
    if (cls.progress) {
      const t = Number(e.time)
      if (Number.isFinite(t) && t > 0 && (progressHeartbeatAt === null || t > progressHeartbeatAt)) {
        progressHeartbeatAt = t
      }
    }
    if (cls.error) {
      errorCount += 1
      lastErrorFingerprint = fingerprint(e)
    }
    // track the fingerprint AFTER classification so identical repeats suppress
    const fp = fingerprint(e)
    if (fp) seen.set(fp, (seen.get(fp) || 0) + 1)
  }
  // If we saw events but none carried a usable timestamp, record the activity
  // at "now" (the events happened by reconcile time even without timestamps).
  if (systemHeartbeatAt === null && (Array.isArray(events) ? events : []).length > 0) {
    systemHeartbeatAt = now
  }
  return { systemHeartbeatAt, progressHeartbeatAt, errorCount, lastErrorFingerprint }
}

/**
 * Decide the per-session SYSTEM heartbeat for one snapshot.
 *
 * The system heartbeat means "the harness/session is reachable", and
 * reachability comes from ENGINE liveness (the presence process answered this
 * snapshot via `systemAliveAt`), never from how recently the session logged
 * events. A quiet session that is reachable (agent waiting on the user, a
 * finished DONE/FAILED turn, an IDLE session, even an empty log) inherits the
 * engine's alive timestamp, keeps its own state and does NOT decay to
 * DISCONNECTED (P0 fix: heartbeat.js/service.js used to equate system liveness
 * with the last event time and a 60s TTL).
 *
 * DISCONNECTED survives in exactly two cases:
 *   1. the engine heartbeat itself is stale or absent (the harness is not
 *      answering), so nothing can be confirmed alive;
 *   2. the per-session loop is genuinely gone: the log shows an open turn
 *      that never closed, the session is NOT in the live sessions/agents
 *      lists, and the log has been silent beyond the system TTL (an orphaned
 *      turn left by a crash/restart: no agent process exists to answer).
 *
 * @param {Object} f
 * @param {number|null} f.sessionHeartbeatAt - log-activity observation (last
 *   event time; null for an empty log).
 * @param {boolean} f.openTurn - the log shows turn/start without a matching
 *   turn/end.
 * @param {boolean} f.loopLive - the session is currently listed by the live
 *   sessions/agents services.
 * @param {number|null} f.systemAliveAt - when the presence engine last
 *   answered (ms epoch; null when it never has).
 * @param {number} [f.now=Date.now()] - snapshot time.
 * @param {number} [f.ttl=DEFAULT_SYSTEM_TTL_MS]
 * @returns {number|null} the effective heartbeat to hand resolveState() and to
 *   publish as the DTO's systemHeartbeatAt. A stale or absent value makes
 *   resolveState() report DISCONNECTED.
 */
export function effectiveSystemAliveAt(f) {
  const now = f && f.now != null ? f.now : Date.now()
  const ttl = f && f.ttl != null ? f.ttl : DEFAULT_SYSTEM_TTL_MS
  const engine = f && Number(f.systemAliveAt) > 0 ? Number(f.systemAliveAt) : null
  const logHb = f && Number(f.sessionHeartbeatAt) > 0 ? Number(f.sessionHeartbeatAt) : null
  // Case 1: the engine has no fresh aliveness -> cannot confirm anything.
  if (engine === null || now - engine > ttl) return engine
  // Case 2: an orphaned open turn on a session that is neither live nor
  // recently active -> the per-session loop is gone; report the stale log
  // heartbeat so resolveState() says DISCONNECTED.
  if (f && f.openTurn && !f.loopLive && (logHb === null || now - logHb > ttl)) return logHb
  // Reachable: this session is served by an answering engine right now.
  return engine
}

/** True when the system heartbeat is fresh enough (design §7: lost → DISCONNECTED). */
export function isSystemAlive(systemHeartbeatAt, now = Date.now(), ttl = DEFAULT_SYSTEM_TTL_MS) {
  if (!systemHeartbeatAt) return false
  return (now - systemHeartbeatAt) <= ttl
}

/**
 * True when progress is stale relative to the threshold (design §7).
 * Pass the meaningful-progress heartbeat, never the system heartbeat:
 * a live-but-quiet agent is STALE-prone, not DISCONNECTED.
 */
export function isProgressStale(progressHeartbeatAt, now = Date.now(), staleMs = 20 * 60 * 1000) {
  if (!progressHeartbeatAt) return true // no progress ever observed => stale-prone
  return (now - progressHeartbeatAt) > staleMs
}
