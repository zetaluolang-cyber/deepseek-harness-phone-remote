// push/vapid.js — VAPID (RFC 8292) keypair + JWT signing for Web Push.
//
// Zero-dependency: ES256 (P-256 / SHA-256) via node:crypto. The public key is
// exported as the raw 65-byte uncompressed point in base64url (the "k" the
// browser needs as `applicationServerKey`); the private key stays a KeyObject.
import {
  generateKeyPairSync,
  createSign,
  randomBytes,
} from 'node:crypto'

/** Encode a Buffer as unpadded base64url (URL-safe, no '='). */
export function base64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

/** Decode unpadded (or padded) base64url into a Buffer. */
export function fromBase64url(str) {
  const s = String(str || '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (s.length % 4)) % 4
  return Buffer.from(s + '='.repeat(pad), 'base64')
}

/** Raw 65-byte uncompressed P-256 point from an exported JWK. */
export function jwkToRawPoint(jwk) {
  const x = fromBase64url(jwk.x)
  const y = fromBase64url(jwk.y)
  if (x.length !== 32 || y.length !== 32) throw new Error('vapid: invalid P-256 JWK coordinates')
  return Buffer.concat([Buffer.from([0x04]), x, y])
}

/**
 * Generate a VAPID keypair.
 * @returns {{ publicKey: Buffer, privateKey: KeyObject, publicKeyB64: string }}
 *   publicKeyB64 is the raw 65-byte point, unpadded base64url (applicationServerKey).
 */
export function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const raw = jwkToRawPoint(jwk)
  return {
    publicKey: raw,
    privateKey,
    publicKeyB64: base64url(raw),
  }
}

/**
 * Sign a VAPID JWT for one push endpoint.
 * @param {Buffer} audience - the push endpoint's origin, e.g. Buffer.from('https://fcm.googleapis.com').
 * @param {string} subject - the `sub` claim (an https: URL or mailto: address).
 * @param {KeyObject} privateKey - P-256 private key (KeyObject from generateKeyPairSync).
 * @param {number} [ttlSeconds=43200] - JWT validity (12h default, VAPID allows up to 24h).
 * @returns {{ jwt: string, publicKeyB64: string }}
 */
export function signVapidToken(audience, subject, privateKey, ttlSeconds = 43200) {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: String(audience),
    exp: now + ttlSeconds,
    sub: String(subject),
  }
  const signingInput = base64url(Buffer.from(JSON.stringify(header))) + '.' + base64url(Buffer.from(JSON.stringify(payload)))
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }) // raw r||s, what JWT ES256 expects
  const jwt = signingInput + '.' + base64url(signature)
  const raw = keyPairToRawPublic(privateKey)
  return { jwt, publicKeyB64: base64url(raw) }
}

/** Raw 65-byte public point derived from a keypair KeyObject (private or public).
 *  The KeyObject from generateKeyPairSync embeds both halves; its JWK export
 *  carries x/y, so we rebuild the raw point from those. */
export function keyPairToRawPublic(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' })
  if (jwk && jwk.x && jwk.y) return jwkToRawPoint(jwk)
  throw new Error('vapid: cannot recover the public key from this key material')
}

/** Fresh 16-byte salt (RFC 8291). */
export function makeSalt() {
  return randomBytes(16)
}

/** Origin (scheme://host[:port]) of a push endpoint URL. */
export function originOf(endpoint) {
  const u = new URL(String(endpoint))
  const port = u.port ? ':' + u.port : ''
  return u.protocol + '//' + u.hostname + port
}
