// presence/redact.js — server-side redaction applied AT THE AUTH BOUNDARY to
// unauthenticated presence responses (F5).
//
// The default pocketStrict=false fence intentionally lets unauthenticated
// callers (same browser-trust origin as the harness GUI) read presence
// STATUS/TASKS so the unpaired PC browser Task Board keeps working. But that
// fence must not leak USER CONTENT (task titles/summaries) to a caller with no
// valid device credential and no companion token. This module strips that
// content while leaving every structural field a v1 consumer needs to render
// state (taskId/sessionId/state/heartbeats/sizeBytes/staleReason) intact.
//
// A redacted task DTO is still a VALID v1 DTO: title/summary are replaced with
// strings (the contract requires strings), so validateTaskDTO() passes.
import { validateTaskDTO } from './api.js'

/** Fixed placeholder used in place of a task title for unauthenticated
 *  callers. Empty or placeholder strings satisfy the frozen DTO contract. */
export const UNAUTH_TITLE = '(paired)'

/** Redact ONE task DTO in place of user content (returns a shallow copy). */
export function redactTaskDTO(dto) {
  if (!dto || typeof dto !== 'object') return dto
  return Object.assign({}, dto, { title: UNAUTH_TITLE, summary: '' })
}

/** Redact the `value` of a presence.tasks response ({ tasks, orb }). */
export function redactTasksValue(value) {
  if (!value || typeof value !== 'object') return value
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.map((t) => (t && typeof t === 'object' ? redactTaskDTO(t) : t))
    : value.tasks
  const orb = value.orb && typeof value.orb === 'object' ? redactTaskDTO(value.orb) : value.orb
  return Object.assign({}, value, { tasks, orb })
}

/** Redact a full { ok: true, value } tasks envelope; error envelopes and
 *  non-object values pass through untouched (fail closed on shape). */
export function redactTasksEnvelope(envelope) {
  if (!envelope || envelope.ok !== true) return envelope
  if (!envelope.value || typeof envelope.value !== 'object') return envelope
  return Object.assign({}, envelope, { value: redactTasksValue(envelope.value) })
}

/** True when a redacted DTO still satisfies the frozen v1 schema (guard used
 *  by tests: redaction must never break the wire contract). */
export function redactedDTOIsValid(dto) {
  return validateTaskDTO(redactTaskDTO(dto)).length === 0
}
