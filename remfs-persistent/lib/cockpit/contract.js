// cockpit/contract.js — Pocket Cockpit stable wire contract (v0.3 Phase 1).
//
// Pure Node (no Cordis, no DOM): the host aggregates DSH session/agent/event
// state into these stable DTOs, and the client renders ONLY this shape. The
// contract decouples the phone UI from DSH's internal event vocabulary, so an
// upstream DSH change touches the host aggregator, never the client.
//
// Session status vocabulary (see classify.js for the rules):
//   RUNNING           — an agent turn is open / live work in progress
//   NEEDS_ATTENTION   — the agent is BLOCKED waiting on the human
//                       (Phase 1: a pending approval; user-question waiting
//                        is Phase 2+)
//   FINISHED          — last turn ended 'completed', no open turn
//   FAILED            — last turn ended 'error', no open turn
//   IDLE              — nothing open and no completed/error terminal turn
//
// Capability model: every paired device carries a capability list. /pocket is
// gated on the 'cockpit' capability (default for existing devices), /remfs on
// 'files'. 'approval' is reserved for Phase 2 — the protocol layers it now so
// a future read-only phone / approval-only wearable needs no credential-model
// change.

/** Capability names. */
export const CAPABILITIES = Object.freeze({
  FILES: 'files',
  COCKPIT: 'cockpit',
  APPROVAL: 'approval',
})

/** Default capability list for newly paired devices (and migration default
 *  for existing devices without a capabilities field). */
export const DEFAULT_DEVICE_CAPABILITIES = Object.freeze([
  CAPABILITIES.FILES,
  CAPABILITIES.COCKPIT,
  CAPABILITIES.APPROVAL,
])

/** Session status values exposed to the phone (C-老师 design: NEEDS YOU is
 *  the highest-priority attention state; FAILED ranks above RUNNING). */
export const STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  FINISHED: 'FINISHED',
  FAILED: 'FAILED',
  IDLE: 'IDLE',
})

/** Display order on the phone: attention first, failure above running.
 *  NEEDS YOU > FAILED > RUNNING > FINISHED > IDLE (design §4, §21). */
export const STATUS_ORDER = Object.freeze({
  [STATUS.NEEDS_ATTENTION]: 0,
  [STATUS.FAILED]: 1,
  [STATUS.RUNNING]: 2,
  [STATUS.FINISHED]: 3,
  [STATUS.IDLE]: 4,
})

/** User-facing status language (design §5): 🟠 NEEDS YOU, 🟢 RUNNING,
 *  ✅ FINISHED, 🔴 FAILED, ⚪ IDLE. Kept in the contract so the client never
 *  invents its own labels. */
export const STATUS_LABEL = Object.freeze({
  [STATUS.NEEDS_ATTENTION]: { dot: '🟠', text: 'NEEDS YOU' },
  [STATUS.RUNNING]: { dot: '🟢', text: 'RUNNING' },
  [STATUS.FINISHED]: { dot: '✅', text: 'FINISHED' },
  [STATUS.FAILED]: { dot: '🔴', text: 'FAILED' },
  [STATUS.IDLE]: { dot: '⚪', text: 'IDLE' },
})

/** Primary CTA per status (design §5, §21): Review / Open / Catch up / Inspect. */
export const STATUS_CTA = Object.freeze({
  [STATUS.NEEDS_ATTENTION]: 'review',
  [STATUS.RUNNING]: 'open',
  [STATUS.FINISHED]: 'catchup',
  [STATUS.FAILED]: 'inspect',
  [STATUS.IDLE]: 'open',
})

/** /pocket operations (Phase 1 — read-only cockpit + away + last-check). */
export const POCKET_OPS = Object.freeze({
  STATUS: 'cockpit.status',
  SESSIONS: 'cockpit.sessions',
  AWAY_START: 'cockpit.away.start',
  AWAY_STOP: 'cockpit.away.stop',
  CHECK: 'cockpit.check',
})

/**
 * Last-check state (design §10, §20-P7): the system AUTOMATICALLY records when
 * the cockpit was last viewed, so the delta has a default attention boundary
 * ("Since your last check") without requiring the user to Start Away first.
 * Away Mode remains as an optional explicit anchor ("Since you left").
 * Stored in the project profile state dir, separate from remfs-security.json.
 * @typedef {Object} LastCheckState
 * @property {number} lastCockpitViewedAt — ms epoch of the last cockpit.viewed
 * @property {number} lastCheckAt         — ms epoch of the last cockpit.check
 */

/** Normalize a parsed last-check payload; fails closed (never trusts junk). */
export function normalizeLastCheckState(raw) {
  if (!raw || typeof raw !== 'object') return { lastCockpitViewedAt: 0, lastCheckAt: 0 }
  const view = Number(raw.lastCockpitViewedAt)
  const check = Number(raw.lastCheckAt)
  return {
    lastCockpitViewedAt: Number.isFinite(view) && view > 0 ? view : 0,
    lastCheckAt: Number.isFinite(check) && check > 0 ? check : 0,
  }
}

/**
 * One cockpit session DTO. The ONLY shape the client reads for a session.
 * @typedef {Object} CockpitSessionDTO
 * @property {string} sessionId
 * @property {string|null} workspaceId
 * @property {string|null} workspacePath
 * @property {string} title
 * @property {string} goal        — best-effort goal/title text (Phase 1: title)
 * @property {string} status      — one of STATUS
 * @property {number} startedAt   — ms epoch
 * @property {number} lastActivityAt — ms epoch
 * @property {Object|null} lastAction — { type, name, summary } or null
 * @property {Object|null} attention — { kind, summary } when NEEDS_ATTENTION
 * @property {Object} delta       — { filesChanged, toolCalls, errors }
 */

/**
 * Build a cockpit session DTO from raw aggregate fields.
 * @param {Object} parts - { sessionId, workspaceId, workspacePath, title,
 *   goal, status, startedAt, lastActivityAt, lastAction, attention, delta }
 */
export function makeSessionDTO(parts) {
  const p = parts || {}
  return {
    sessionId: String(p.sessionId || ''),
    workspaceId: p.workspaceId == null ? null : String(p.workspaceId),
    workspacePath: p.workspacePath == null ? null : String(p.workspacePath),
    title: String(p.title || p.goal || 'Untitled'),
    goal: String(p.goal || p.title || ''),
    status: p.status || STATUS.IDLE,
    startedAt: Number(p.startedAt) || 0,
    lastActivityAt: Number(p.lastActivityAt) || 0,
    lastAction: p.lastAction || null,
    attention: p.attention || null,
    delta: {
      filesChanged: Number((p.delta && p.delta.filesChanged) || 0),
      toolCalls: Number((p.delta && p.delta.toolCalls) || 0),
      errors: Number((p.delta && p.delta.errors) || 0),
      approvals: Number((p.delta && p.delta.approvals) || 0),
      testRuns: Number((p.delta && p.delta.testRuns) || 0),
      testsPassed: Number((p.delta && p.delta.testsPassed) || 0),
      agentFinished: !!(p.delta && p.delta.agentFinished),
    },
  }
}

/**
 * Away-mode state stored in the PROJECT's own DSH profile state directory —
 * deliberately separate from remfs-security.json (security vs product state).
 * @typedef {Object} AwayState
 * @property {boolean} away
 * @property {string|null} awaySince — ISO 8601 timestamp, or null when not away
 */

/** Validate a parsed away-state payload; fails closed (never trusts junk). */
export function normalizeAwayState(raw) {
  if (!raw || typeof raw !== 'object') return { away: false, awaySince: null }
  const away = raw.away === true
  const since = typeof raw.awaySince === 'string' && raw.awaySince ? raw.awaySince : null
  // away requires a timestamp; a non-away state never carries one (a stale
  // since must not leak into the UI when away was cleared).
  if (!away || !since) return { away: false, awaySince: null }
  if (!Number.isFinite(Date.parse(since))) return { away: false, awaySince: null }
  return { away, awaySince: since }
}

/** ms epoch of an ISO awaySince (0 when absent). */
export function awaySinceMs(awaySince) {
  if (!awaySince) return 0
  const t = Date.parse(awaySince)
  return Number.isFinite(t) ? t : 0
}

/** True when the device capability list includes `cap` (or is empty/absent →
 *  legacy device → default all capabilities). */
export function hasCapability(capabilities, cap) {
  const list = Array.isArray(capabilities) && capabilities.length > 0
    ? capabilities
    : DEFAULT_DEVICE_CAPABILITIES
  return list.includes(cap)
}
