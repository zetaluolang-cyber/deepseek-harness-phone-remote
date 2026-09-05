// push/webpush.js — Web Push message encryption (RFC 8291) and delivery.
//
// Zero-dependency: node:crypto only. The derivation follows RFC 8291 §3.4
// pseudocode EXACTLY (verified against the RFC Appendix A + §5 test vector):
//
//   PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)                  # extract
//   key_info = "WebPush: info" || 0x00 || ua_public || as_public
//   IKM     = HMAC-SHA-256(PRK_key, key_info || 0x01)                 # expand
//   PRK     = HMAC-SHA-256(salt, IKM)                                 # extract
//   CEK     = HMAC-SHA-256(PRK, "Content-Encoding: aes128gcm" || 0x00 || 0x01)[0..15]
//   NONCE   = HMAC-SHA-256(PRK, "Content-Encoding: nonce" || 0x00 || 0x01)[0..11]
//
// Wire format (RFC 8188 aes128gcm, single record):
//   header = salt(16) || rs(4, BE, 4096) || idlen(1, 65) || server_pub(65)
//   body   = header || AES-128-GCM(plaintext, CEK, NONCE, aad=header) || tag(16)
//   plaintext = payload || 0x02        (padding delimiter APPENDED, RFC 8291 §5)
import {
  createECDH,
  createCipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'
import { base64url, fromBase64url, originOf, signVapidToken } from './vapid.js'

const RECORD_SIZE = 4096

/** RFC 5869 HKDF-Extract (HMAC-SHA-256). */
function hkdfExtract(salt, ikm) {
  return createHmac('sha256', salt).update(ikm).digest()
}

/** RFC 5869 HKDF-Expand, FIRST block only (single-record push, counter=1). */
function hkdfExpand(prk, info, length) {
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length)
}

/**
 * RFC 8291 encryption against a PREPARED ECDH instance (the ephemeral server
 * keypair). Exported so tests can reproduce the RFC Appendix A vector (they
 * supply the salt); normal callers use encryptPayload().
 * @param {import('node:crypto').ECDH} ecdh - server ephemeral keypair (keys generated).
 * @param {Buffer} clientPub - 65-byte uncompressed receiver (user agent) public point.
 * @param {Buffer} authSecret - 16-byte subscription auth secret.
 * @param {Buffer} payload - plaintext.
 * @param {Buffer} [salt] - fixed salt (tests); random when omitted.
 * @returns {{ body: Buffer, serverPublicKey: Buffer, salt: Buffer }}
 */
export function encryptWithEcdh(ecdh, clientPub, authSecret, payload, salt) {
  const serverPub = ecdh.getPublicKey(null, 'uncompressed') // 65 bytes
  const shared = ecdh.computeSecret(clientPub) // 32 bytes

  const prkKey = hkdfExtract(authSecret, shared) // RFC 8291 §3.4
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0x00]),
    clientPub, // ua_public (receiver)
    serverPub, // as_public (sender)
  ])
  const ikm = hkdfExpand(prkKey, keyInfo, 32)
  const s = salt || randomBytes(16)
  const prk = hkdfExtract(s, ikm)
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12)

  const plain = Buffer.concat([
    Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'),
    Buffer.from([0x02]), // padding delimiter APPENDED (RFC 8291 §5)
  ])

  const header = Buffer.alloc(21 + serverPub.length)
  s.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header[20] = serverPub.length
  serverPub.copy(header, 21)

  const cipher = createCipheriv('aes-128-gcm', cek, nonce, { authTagLength: 16 })
  // RFC 8188 aes128gcm: the AAD is EMPTY (the header is not authenticated —
  // verified against the RFC 8291 §5 test vector; http_ece behaves the same).
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return { body: Buffer.concat([header, enc, tag]), serverPublicKey: serverPub, salt: s }
}

/**
 * Encrypt a payload for a push subscription (RFC 8291).
 * @param {string} clientPublicKeyB64 - subscription keys.p256dh (unpadded base64url).
 * @param {string} authSecretB64 - subscription keys.auth (unpadded base64url).
 * @param {Buffer|string} payload - plaintext message.
 * @returns {{ body: Buffer, serverPublicKey: Buffer }}
 */
export function encryptPayload(clientPublicKeyB64, authSecretB64, payload) {
  const clientPub = fromBase64url(clientPublicKeyB64)
  const authSecret = fromBase64url(authSecretB64)
  if (clientPub.length !== 65 || clientPub[0] !== 0x04) throw new Error('webpush: p256dh must be a 65-byte uncompressed point')
  if (authSecret.length !== 16) throw new Error('webpush: auth secret must be 16 bytes')

  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const { body, serverPublicKey } = encryptWithEcdh(ecdh, clientPub, authSecret, Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'))
  return { body, serverPublicKey }
}

/**
 * Send one Web Push message to a subscription endpoint.
 * @param {Object} opts
 * @param {string} opts.endpoint - the subscription endpoint URL.
 * @param {Object} opts.keys - { p256dh, auth } subscription keys.
 * @param {Buffer|string} opts.payload - plaintext message.
 * @param {Object} opts.vapid - { publicKeyB64, privateKey } keypair.
 * @param {string} opts.subject - VAPID `sub` claim (https: URL or mailto:).
 * @param {Object} [opts.extra] - { ttlSeconds=86400, urgency='normal' }.
 * @param {Function} [opts.fetchImpl=fetch] - injectable fetch (tests).
 * @returns {Promise<{ status: 'sent'|'gone'|'failed', httpStatus?: number, error?: string }>}
 */
export async function sendPush(opts) {
  const {
    endpoint,
    keys,
    payload,
    vapid,
    subject,
    extra = {},
    fetchImpl = globalThis.fetch,
  } = opts
  const ttlSeconds = extra.ttlSeconds ?? 86400
  const urgency = extra.urgency ?? 'normal'
  const audience = originOf(endpoint)
  const { jwt, publicKeyB64 } = signVapidToken(audience, subject, vapid.privateKey)
  const { body } = encryptPayload(keys.p256dh, keys.auth, payload)

  let res
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'vapid t=' + jwt + ', k=' + publicKeyB64,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        Urgency: urgency,
      },
      body,
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    return { status: 'failed', error: 'network: ' + String((e && e.message) || e) }
  }
  if (res.status === 201 || res.status === 202) return { status: 'sent', httpStatus: res.status }
  if (res.status === 404 || res.status === 410) return { status: 'gone', httpStatus: res.status }
  return { status: 'failed', httpStatus: res.status, error: 'http ' + res.status }
}

/**
 * Lightweight host-side reachability probe of a push endpoint ORIGIN, used at
 * subscribe time (1.4). Sends an OPTIONS request to the origin with a short
 * timeout; ANY HTTP answer (even 403/405) proves the push service is reachable
 * from the host. The probe NEVER blocks the subscribe — a negative result is
 * surfaced as a `reachabilityWarning` on the response so the client can warn
 * the user (FCM can be unreachable from some networks while the endpoint is
 * still perfectly valid for the phone's push service to deliver).
 * @param {string} endpoint - the subscription endpoint URL.
 * @param {Object} [opts] - { fetchImpl = globalThis.fetch, timeoutMs = 4000 }.
 * @returns {Promise<{ reachable: boolean, reason?: string }>}
 */
export async function probeEndpointOrigin(endpoint, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 4000
  let origin
  try {
    origin = originOf(endpoint)
  } catch (e) {
    return { reachable: false, reason: 'invalid endpoint URL: ' + String((e && e.message) || e) }
  }
  try {
    await fetchImpl(origin, {
      method: 'OPTIONS',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { reachable: true }
  } catch (e) {
    const code = String((e && e.name) || '')
    const reason = code === 'TimeoutError' || /timeout/i.test(String((e && e.message) || e))
      ? 'origin timed out after ' + timeoutMs + 'ms'
      : String((e && e.message) || e)
    return { reachable: false, reason }
  }
}

/** Compact base64url key for embedding in JS/JSON (re-export for callers). */
export { base64url, fromBase64url, originOf }
