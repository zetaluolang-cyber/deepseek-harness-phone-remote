// presence/api.js — Presence API v1 FROZEN contract (Phase D).
//
// This module is the single source of truth for the presence wire contract:
// the API version, the RPC operation names, the envelope, the task DTO shape
// and the error code vocabulary. Nothing here may change without a new API
// version (v2) — see docs/presence-api-v1.md for the freeze policy.
//
// Freeze semantics (what consumers may rely on):
//   - presence.status / presence.tasks operation names never change.
//   - The envelope is always { ok: true, value } or { ok: false, error }.
//   - error.code is ALWAYS one of ERROR_CODES.
//   - Every task DTO has exactly the fields makeTaskDTO returns; new fields
//     may be ADDED in a backward-compatible way, never removed/renamed.
//   - The 7-state model and its priority order never change (design §4, §43).
//
// Backward-compatible evolution is allowed within v1 (adding fields,
// adding error codes is NOT allowed; adding operations is allowed).
import { STATE, STATE_PRIORITY, makeTaskDTO } from './contract.js'

/** Frozen API version (the `apiVersion` field of presence.status). */
export const API_VERSION = 'v1'

/** Frozen engine identifier (unchanged since Phase A). */
export const API_ENGINE = 'presence-v1'

/** Frozen RPC operation names (aligned with PRESENCE_OPS). */
export const API_OPS = Object.freeze({
  STATUS: 'presence.status',
  TASKS: 'presence.tasks',
})

/** Frozen error-code vocabulary. Every error a consumer can receive is here. */
export const ERROR_CODES = Object.freeze({
  AUTH_INVALID: 'auth-invalid',             // device credential rejected
  STORE_CORRUPT: 'store-corrupt',           // security store unreadable
  CAPABILITY_DENIED: 'capability-denied',   // frozen legacy code (cockpit gate removed; kept for v1 compat, never emitted)
  BAD_REQUEST: 'bad-request',               // unknown operation
  CAPABILITY_UNAVAILABLE: 'capability-unavailable', // sessionQuery missing (presence disabled)
  SESSIONS_UNAVAILABLE: 'sessions-unavailable',     // session query failed
})

/** The frozen 7-state set (re-exported for the docs/tests, never changes). */
export const API_STATES = Object.freeze(Object.keys(STATE).sort())

/**
 * Validate one task DTO against the frozen v1 shape.
 * @param {*} dto - value to validate.
 * @returns {string[]} list of problems ([] = valid).
 */
export function validateTaskDTO(dto) {
  const problems = []
  if (!dto || typeof dto !== 'object') return ['task DTO must be an object']
  const str = (v) => typeof v === 'string'
  const num = (v) => typeof v === 'number' && Number.isFinite(v)
  if (!str(dto.taskId) || !dto.taskId) problems.push('taskId: non-empty string')
  if (!str(dto.sessionId) || !dto.sessionId) problems.push('sessionId: non-empty string')
  if (!str(dto.title)) problems.push('title: string')
  if (!API_STATES.includes(dto.state)) problems.push('state: one of ' + API_STATES.join('/'))
  if (!str(dto.summary)) problems.push('summary: string')
  if (dto.systemHeartbeatAt !== null && !str(dto.systemHeartbeatAt)) problems.push('systemHeartbeatAt: ISO string or null')
  if (dto.progressHeartbeatAt !== null && !str(dto.progressHeartbeatAt)) problems.push('progressHeartbeatAt: ISO string or null')
  if (!num(dto.startedAt)) problems.push('startedAt: finite number')
  if (!num(dto.updatedAt)) problems.push('updatedAt: finite number')
  if (dto.attention !== null && (!dto.attention || typeof dto.attention !== 'object' || !str(dto.attention.kind))) {
    problems.push('attention: null or { kind, summary }')
  }
  if (dto.staleReason !== null && !Array.isArray(dto.staleReason)) problems.push('staleReason: null or string[]')
  if (!num(dto.sizeBytes) || dto.sizeBytes < 0) problems.push('sizeBytes: non-negative finite number')
  return problems
}

/**
 * Validate the presence.tasks response value.
 * @param {*} value - the { ok: true, value } payload.
 * @returns {string[]} list of problems ([] = valid).
 */
export function validateTasksValue(value) {
  const problems = []
  if (!value || typeof value !== 'object') return ['tasks value must be an object']
  if (!Array.isArray(value.tasks)) return ['tasks: array required']
  for (const t of value.tasks) {
    for (const p of validateTaskDTO(t)) problems.push(p)
  }
  if (value.orb !== null && value.orb !== undefined) {
    if (!value.orb || typeof value.orb !== 'object') problems.push('orb: task DTO or null')
    else for (const p of validateTaskDTO(value.orb)) problems.push('orb.' + p)
  }
  return problems
}

/**
 * Validate the presence.status response value (frozen fields).
 * @param {*} value - the { ok: true, value } payload.
 * @returns {string[]} list of problems ([] = valid).
 */
export function validateStatusValue(value) {
  const problems = []
  if (!value || typeof value !== 'object') return ['status value must be an object']
  if (value.engine !== API_ENGINE) problems.push('engine: must be ' + API_ENGINE)
  if (value.apiVersion !== API_VERSION) problems.push('apiVersion: must be ' + API_VERSION)
  if (typeof value.staleMinutes !== 'number' || !Number.isFinite(value.staleMinutes)) problems.push('staleMinutes: finite number')
  if (typeof value.serverTime !== 'string') problems.push('serverTime: ISO string')
  if (!Array.isArray(value.capabilities)) problems.push('capabilities: array')
  return problems
}

/** True when a value is a valid presence task DTO (fail-closed). */
export function isTaskDTO(dto) {
  return validateTaskDTO(dto).length === 0
}
