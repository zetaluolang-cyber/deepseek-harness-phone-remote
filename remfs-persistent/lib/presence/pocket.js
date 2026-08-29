// presence/pocket.js — the /pocket endpoint dispatcher, extracted from host.js
// so the authorization rules are unit-testable (host.js only wires Cordis).
//
// Authorization layers, in order:
//   1. store-corrupt          -> always an error (fail closed)
//   2. no/invalid credential  -> read-only STATUS/TASKS allowed inside the
//      browser-trust fence UNLESS pocketStrict; everything else auth-invalid
//   3. capability             -> push.subscribe/unsubscribe require `files`
//
// Why `files` gates push: a push payload carries the task title and summary —
// content strictly WEAKER than what the files capability already trusts the
// device with (it can read every file in the allowed workspace). Gating on
// `files` makes narrowing real (strip files -> no more content pushed to that
// device) without breaking any existing pairing: every normally paired device
// holds `files`. A dedicated `presence` capability would need store schema
// versioning to avoid cutting off devices paired before it existed — not
// worth it while `files` dominates the same information.
//
// The error code is `capability-denied` — already in the FROZEN v1 vocabulary
// (it was reserved when the cockpit gate was removed), so no contract change.
import { PRESENCE_OPS } from './contract.js'
import { deviceHasCapability } from '../security.js'

const pocketErr = (code, message) => ({ ok: false, error: { code, message, details: {} } })

/**
 * @param deps - {
 *   presence:        { status(deviceOrNull), tasks() },
 *   verifyDevice:    (deviceId, credential) => Promise<{ ok, device } | { error }>,
 *   pocketStrict:    boolean,
 *   pushSubscribe:   (device, payload) => Promise<envelope>,
 *   pushUnsubscribe: (device, payload) => Promise<envelope>,
 * }
 */
export function createPocketHandler(deps) {
  const { presence, verifyDevice, pocketStrict, pushSubscribe, pushUnsubscribe } = deps
  return async function pocketHandler(endpoint, payload) {
    const authRes = await verifyDevice(
      payload && payload.deviceId,
      payload && payload.credential,
    )
    if (authRes.error === 'store-corrupt') {
      return pocketErr('store-corrupt', 'security store corrupt — see ~/.dsh/remfs-security.json.corrupt-*')
    }
    // Read-only presence is allowed WITHOUT a device credential: the Orb /
    // Board render inside the same browser-trust fence as the GUI itself,
    // and the DTOs expose only what the GUI already shows. pocketStrict=true
    // disables this fence and every call requires a valid credential.
    if (authRes.error) {
      if (!pocketStrict) {
        if (endpoint === PRESENCE_OPS.STATUS) return presence.status(null)
        if (endpoint === PRESENCE_OPS.TASKS) return presence.tasks()
      }
      return pocketErr('auth-invalid', 'device authentication failed — re-pair the device')
    }
    switch (endpoint) {
      case PRESENCE_OPS.STATUS: return presence.status(authRes.device)
      case PRESENCE_OPS.TASKS: return presence.tasks()
      case PRESENCE_OPS.PUSH_SUBSCRIBE:
      case PRESENCE_OPS.PUSH_UNSUBSCRIBE: {
        if (!deviceHasCapability(authRes.device, 'files')) {
          return pocketErr('capability-denied',
            'push requires the files capability (pushes carry task titles/summaries)')
        }
        return endpoint === PRESENCE_OPS.PUSH_SUBSCRIBE
          ? pushSubscribe(authRes.device, payload)
          : pushUnsubscribe(authRes.device, payload)
      }
      default: return pocketErr('bad-request', 'unknown /pocket endpoint: ' + String(endpoint))
    }
  }
}
