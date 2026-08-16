// presence/heartbeat.js — dual heartbeat + meaningful-progress determination
// (Agent Presence 设计书 §5, §6).
//
// System heartbeat  = "is the harness/session still reachable?"
// Progress heartbeat = "when did the task last genuinely move forward?"
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
    // Any recognized session event refreshes the SYSTEM heartbeat: the agent
    // log is live. (This is "can we communicate", not "is it progressing".)
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
  // If we saw events but none carried a usable timestamp, system heartbeat is
  // "now" (the reconcile itself proves reachability).
  if (systemHeartbeatAt === null && (Array.isArray(events) ? events : []).length > 0) {
    systemHeartbeatAt = now
  }
  return { systemHeartbeatAt, progressHeartbeatAt, errorCount, lastErrorFingerprint }
}

/** True when the system heartbeat is fresh enough (design §7: lost → DISCONNECTED). */
export function isSystemAlive(systemHeartbeatAt, now = Date.now(), ttl = DEFAULT_SYSTEM_TTL_MS) {
  if (!systemHeartbeatAt) return false
  return (now - systemHeartbeatAt) <= ttl
}

/** True when progress is stale relative to the threshold (design §7). */
export function isProgressStale(progressHeartbeatAt, now = Date.now(), staleMs = 20 * 60 * 1000) {
  if (!progressHeartbeatAt) return true // no progress ever observed => stale-prone
  return (now - progressHeartbeatAt) > staleMs
}
