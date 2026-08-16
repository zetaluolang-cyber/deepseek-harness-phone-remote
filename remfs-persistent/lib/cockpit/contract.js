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

/** Session status values exposed to the phone. */
export const STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  FINISHED: 'FINISHED',
  FAILED: 'FAILED',
  IDLE: 'IDLE',
})

/** /pocket operations (Phase 1 — read-only cockpit + away mode). */
export const POCKET_OPS = Object.freeze({
  STATUS: 'cockpit.status',
  SESSIONS: 'cockpit.sessions',
  AWAY_START: 'cockpit.away.start',
  AWAY_STOP: 'cockpit.away.stop',
})

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
