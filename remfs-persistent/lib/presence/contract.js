// presence/contract.js — Agent Presence stable wire contract (Agent Presence
// 设计书, Phase A core).
//
// The single source of truth for presence state. Orb / Tasks / Notification
// (Phase B) must ALL consume ONLY what this module and AgentPresenceService
// produce — no UI may re-derive state from raw events (design §25: any state
// inconsistency is a blocking bug).
//
// 7-state model (design §4):
//   IDLE          — session exists, no task executing
//   RUNNING       — agent working AND recent meaningful progress observed
//   STALE         — agent claims running, system alive, but NO meaningful
//                   progress for >= threshold ("possibly stalled" — never
//                   assert deadlock, only "no observed progress")
//   NEEDS_USER    — agent cannot continue without human input/approval
//   FAILED        — agent stopped due to an error and cannot self-recover
//   DONE          — current task completed normally (may decay to IDLE later)
//   DISCONNECTED  — presence cannot confirm harness/agent is alive (distinct
//                   from STALE: STALE = alive but not progressing,
//                   DISCONNECTED = unknown whether alive)
//
// Priority for a single-Orb display (design §43):
//   NEEDS_USER > FAILED > STALE > RUNNING > DONE > IDLE

export const STATE = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  STALE: 'STALE',
  NEEDS_USER: 'NEEDS_USER',
  FAILED: 'FAILED',
  DONE: 'DONE',
  DISCONNECTED: 'DISCONNECTED',
})

/** Single-Orb display priority (design §43): lower = shown first. */
export const STATE_PRIORITY = Object.freeze({
  [STATE.NEEDS_USER]: 0,
  [STATE.FAILED]: 1,
  [STATE.STALE]: 2,
  [STATE.RUNNING]: 3,
  [STATE.DONE]: 4,
  [STATE.IDLE]: 5,
  [STATE.DISCONNECTED]: 6,
})

/** Default STALE threshold (configurable 10/20/30 min, design §7). */
export const DEFAULT_STALE_MS = 20 * 60 * 1000

/** Allowed STALE thresholds (min). */
export const STALE_THRESHOLDS_MIN = Object.freeze([10, 20, 30])

/** Validate a stale-threshold minutes value; fails closed to default. */
export function normalizeStaleMs(minutes) {
  const n = Number(minutes)
  if (Number.isFinite(n) && STALE_THRESHOLDS_MIN.includes(n)) return n * 60 * 1000
  return DEFAULT_STALE_MS
}

/** Heartbeat semantics (design §5):
 *  systemHeartbeatAt  — "is the harness/session still reachable?" (RPC,
 *                       session event, stream activity, host health)
 *  progressHeartbeatAt — "when did the task last genuinely move forward?"
 *                       (meaningful progress only, never plain activity)
 */
export const HEARTBEAT_KIND = Object.freeze({
  SYSTEM: 'system',
  PROGRESS: 'progress',
})

/**
 * Meaningful progress classes (design §6). Each event that updates the
 * progress heartbeat must map to one of these; events that do not (plain
 * heartbeat, UI refresh, repeated identical tool, repeated identical error,
 * CPU/token/stream activity) must NOT touch it.
 */
export const PROGRESS_KIND = Object.freeze({
  PLAN_STEP: 'plan-step',           // new plan step / phase change
  TOOL_SUCCESS: 'tool-success',     // tool completed with a substantive result
  FILE_DIFF: 'file-diff',           // file diff changed
  TEST_CHANGE: 'test-change',       // test result changed
  ERROR_CHANGE: 'error-change',     // error state changed (new/recovered)
  APPROVAL_RESOLVED: 'approval-resolved',
  QUESTION_RESOLVED: 'question-resolved',
  SUBAGENT_DONE: 'subagent-done',
  TASK_COMPLETE: 'task-complete',
})

/** User-facing state language (design §11): shape/icon + text (never color only). */
export const STATE_LABEL = Object.freeze({
  [STATE.IDLE]: { icon: '○', text: 'Idle' },
  [STATE.RUNNING]: { icon: '●', text: 'Running' },
  [STATE.STALE]: { icon: '◐', text: 'Possibly stalled' },
  [STATE.NEEDS_USER]: { icon: '!', text: 'Needs you' },
  [STATE.FAILED]: { icon: '×', text: 'Failed' },
  [STATE.DONE]: { icon: '✓', text: 'Done' },
  [STATE.DISCONNECTED]: { icon: '?', text: 'Disconnected' },
})

/** /pocket presence operations (Phase A validation channel; no UI yet). */
export const PRESENCE_OPS = Object.freeze({
  STATUS: 'presence.status',
  TASKS: 'presence.tasks',
  PUSH_SUBSCRIBE: 'push.subscribe',
  PUSH_UNSUBSCRIBE: 'push.unsubscribe',
  // Added 2026-08 (adding operations is allowed within the v1 freeze): sends
  // an immediate test notification to the CALLER's subscriptions, so a dead
  // push channel is discovered at setup time, not when an agent fails.
  PUSH_TEST: 'push.test',
})

/**
 * One presence task DTO (design §8). The ONLY shape consumers read.
 * @typedef {Object} PresenceTaskDTO
 * @property {string} taskId
 * @property {string} sessionId
 * @property {string|null} workspaceId
 * @property {string} title
 * @property {string} state       — one of STATE
 * @property {string} summary     — PROGRESS not ACTIVITY (design §9)
 * @property {string|null} systemHeartbeatAt
 * @property {string|null} progressHeartbeatAt
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {Object|null} attention — { kind, summary } when NEEDS_USER
 * @property {Object|null} staleReason — explainable facts when STALE (§42)
 * @property {number} sizeBytes — persisted session dir size on disk (0 when
 *   the host cannot measure it); clients show it and suggest archiving
 *   sessions above 10 MB
 */

/** Build a presence task DTO with stable defaults. */
export function makeTaskDTO(parts) {
  const p = parts || {}
  return {
    taskId: String(p.taskId || ''),
    sessionId: String(p.sessionId || ''),
    workspaceId: p.workspaceId == null ? null : String(p.workspaceId),
    title: String(p.title || 'Untitled'),
    state: p.state || STATE.IDLE,
    summary: String(p.summary || ''),
    systemHeartbeatAt: p.systemHeartbeatAt || null,
    progressHeartbeatAt: p.progressHeartbeatAt || null,
    startedAt: Number(p.startedAt) || 0,
    updatedAt: Number(p.updatedAt) || 0,
    attention: p.attention || null,
    staleReason: p.staleReason || null,
    sizeBytes: Number(p.sizeBytes) || 0,
  }
}

/** ms epoch of an ISO timestamp (0 when absent/invalid). */
export function tsMs(iso) {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** Pick the task that should drive a single Orb (design §43). */
export function highestPriorityTask(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  if (list.length === 0) return null
  let best = null
  for (const t of list) {
    if (!t) continue
    if (best === null) { best = t; continue }
    const a = STATE_PRIORITY[t.state] ?? 99
    const b = STATE_PRIORITY[best.state] ?? 99
    if (a < b) best = t
  }
  return best
}
