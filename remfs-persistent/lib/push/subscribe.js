// push/subscribe.js — subscribe-time policy for /pocket push.subscribe.
//
// Pure orchestration extracted from host.js (which stays a thin Cordis
// adapter) so the security rules are unit-testable:
//   1. shape check (normalizeSubscription)
//   2. endpoint allowlist (1.2): only https endpoints on KNOWN_PUSH_HOSTS or
//      the operator's pushEndpointAllow may be stored — the host later FETCHES
//      the endpoint, so an arbitrary http(s) URL is a host-side SSRF +
//      task-content exfiltration surface.
//   3. best-effort origin reachability probe (1.4): a failure never blocks the
//      subscribe (FCM may be unreachable from some networks) — it is returned
//      as a `reachabilityWarning` on the ok envelope so the phone can show it.
//   4. persist the subscription.
//
// Error codes stay inside the frozen v1 vocabulary ('bad-request' for a
// rejected endpoint; store write failures surface the host's existing
// 'store-write-failed' wrapper). New error codes are NOT allowed by the freeze.
import { normalizeSubscription, allowedPushEndpoint } from './store.js'
import { probeEndpointOrigin } from './webpush.js'

const err = (code, message) => ({ ok: false, error: { code, message, details: {} } })

/**
 * @param {Object} deps
 * @param {(raw: any) => Object|null} [deps.normalizeSubscription]
 * @param {(endpoint: string, extraAllow: string[]) => {allowed: boolean, reason?: string}} [deps.isEndpointAllowed]
 * @param {string[]} [deps.extraAllow] - operator extra endpoints/hosts.
 * @param {(endpoint: string) => Promise<{reachable: boolean, reason?: string}>} [deps.probeEndpoint]
 * @param {(deviceId: string, sub: Object, lang?: string) => Promise<any>} deps.addSubscription
 * @param {Object} device - verified device ({ id }).
 * @param {Object} payload - the /pocket push.subscribe payload.
 * @returns {Promise<{ok: boolean, value?: Object, error?: Object}>}
 */
export async function handlePushSubscribeRequest(deps, device, payload) {
  const d = deps || {}
  const normalize = typeof d.normalizeSubscription === 'function' ? d.normalizeSubscription : normalizeSubscription
  const isAllowed = typeof d.isEndpointAllowed === 'function' ? d.isEndpointAllowed : allowedPushEndpoint
  const probe = typeof d.probeEndpoint === 'function' ? d.probeEndpoint : probeEndpointOrigin
  const extraAllow = Array.isArray(d.extraAllow) ? d.extraAllow : []

  const sub = normalize(payload && payload.subscription)
  if (!sub) return err('bad-request', 'push.subscribe: invalid subscription payload')

  const allow = isAllowed(sub.endpoint, extraAllow)
  if (!allow.allowed) {
    return err('bad-request', allow.reason || 'push.subscribe: endpoint origin not allowed')
  }

  // Reachability is a WARNING channel, never a gate: subscribe regardless and
  // let the phone decide what to tell the user.
  let warning = null
  try {
    const probeRes = await probe(sub.endpoint)
    if (!probeRes || probeRes.reachable !== true) {
      warning = String((probeRes && probeRes.reason) || 'endpoint origin did not answer the host probe')
    }
  } catch (e) {
    warning = String((e && e.message) || 'endpoint probe failed')
  }

  await d.addSubscription(String(device.id), sub, payload && payload.lang)

  const value = { subscribed: true, endpoint: sub.endpoint }
  if (warning) value.reachabilityWarning = warning
  return { ok: true, value }
}
