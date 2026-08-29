// Web Push protocol tests: VAPID (RFC 8292) JWT + aes128gcm (RFC 8291) crypto.
// Run: node --test test/webpush.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createECDH,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  randomBytes,
} from 'node:crypto'
import {
  generateVapidKeys,
  signVapidToken,
  base64url,
  fromBase64url,
  originOf,
} from '../lib/push/vapid.js'
import {
  encryptPayload,
  encryptWithEcdh,
  sendPush,
} from '../lib/push/webpush.js'

// ------------------------------------------------------------------ VAPID

test('VAPID: JWT structure and ES256 raw r||s signature', async () => {
  const keys = generateVapidKeys()
  assert.equal(keys.publicKey.length, 65)
  assert.equal(keys.publicKey[0], 0x04)

  const audience = 'https://fcm.googleapis.com'
  const t = signVapidToken(audience, 'mailto:ops@example.com', keys.privateKey)
  const [h, p, s] = t.jwt.split('.')
  assert.equal(JSON.parse(fromBase64url(h).toString()).alg, 'ES256')
  const payload = JSON.parse(fromBase64url(p).toString())
  assert.equal(payload.aud, audience)
  assert.equal(payload.sub, 'mailto:ops@example.com')
  assert.ok(payload.exp > Math.floor(Date.now() / 1000))
  assert.equal(fromBase64url(s).length, 64) // raw r||s

  // Verify with WebCrypto (subtle.verify expects raw r||s for ECDSA).
  const raw = fromBase64url(t.publicKeyB64)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: raw.subarray(1, 33).toString('base64url'),
    y: raw.subarray(33, 65).toString('base64url'),
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64url(s),
    new TextEncoder().encode(h + '.' + p),
  )
  assert.equal(ok, true)
})

test('VAPID: PEM round-trip keeps the same public key', () => {
  const keys = generateVapidKeys()
  const k2 = createPrivateKey(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const t1 = signVapidToken('https://push.example.com', 'mailto:a@b.c', keys.privateKey)
  const t2 = signVapidToken('https://push.example.com', 'mailto:a@b.c', k2)
  assert.equal(t1.publicKeyB64, t2.publicKeyB64)
})

test('VAPID: originOf extracts scheme/host/port', () => {
  assert.equal(originOf('https://fcm.googleapis.com/fcm/send/abc'), 'https://fcm.googleapis.com')
  assert.equal(originOf('https://updates.push.services.mozilla.com/wpush/v2/x'), 'https://updates.push.services.mozilla.com')
  assert.equal(originOf('http://localhost:8080/push'), 'http://localhost:8080')
})

// ------------------------------------------------------------- encryption

/** Reverse the RFC 8291 key schedule and decrypt an aes128gcm body. */
function decryptBody(body, clientEcdh, authSecret) {
  const salt = body.subarray(0, 16)
  const rs = body.readUInt32BE(16)
  const idlen = body[20]
  const serverPub = body.subarray(21, 21 + idlen)
  const rest = body.subarray(21 + idlen)
  const ct = rest.subarray(0, rest.length - 16)
  const tag = rest.subarray(rest.length - 16)
  assert.equal(rs, 4096)
  assert.equal(idlen, 65)

  const shared = clientEcdh.computeSecret(serverPub)
  const prkKey = createHmac('sha256', authSecret).update(shared).digest()
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0x00]),
    clientEcdh.getPublicKey(null, 'uncompressed'),
    serverPub,
  ])
  const ikm = createHmac('sha256', prkKey).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest().subarray(0, 32)
  const prk = createHmac('sha256', salt).update(ikm).digest()
  const cek = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).digest().subarray(0, 16)
  const nonce = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).digest().subarray(0, 12)
  const header = body.subarray(0, 21 + idlen) // header is NOT the GCM AAD (RFC 8188)
  const d = createDecipheriv('aes-128-gcm', cek, nonce, { authTagLength: 16 })
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

test('RFC 8291 Appendix A + Section 5: exact official test vector', () => {
  // Inputs straight from RFC 8291 §5 / Appendix A.
  const asPrivate = fromBase64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw')
  const uaPublic = fromBase64url('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4')
  const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'
  const authSecret = fromBase64url('BTBZMqHH6r4Tts7J_aSIgg')
  const salt = fromBase64url('DGv6ra1nlYgDCS1FRnbzlw')
  const payload = Buffer.from('When I grow up, I want to be a watermelon')
  const expectedBody =
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_' +
    'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(asPrivate)
  assert.equal(base64url(ecdh.getPublicKey(null, 'uncompressed')), asPublic) // sanity: our keypair matches the RFC

  const { body } = encryptWithEcdh(ecdh, uaPublic, authSecret, payload, salt)
  assert.equal(base64url(body), expectedBody)
})

test('aes128gcm: encryption round-trips and body layout matches RFC 8188', () => {
  const clientEcdh = createECDH('prime256v1')
  clientEcdh.generateKeys()
  const clientPub = clientEcdh.getPublicKey(null, 'uncompressed')
  const authSecret = randomBytes(16)
  const payload = Buffer.from(JSON.stringify({ title: '需要你', body: 'hello — world' }), 'utf8')

  const { body } = encryptPayload(base64url(clientPub), base64url(authSecret), payload)

  // Header layout: salt(16) rs(4) idlen(1) serverPub(65) + ciphertext(16+len)
  assert.equal(body[20], 65)
  assert.equal(body.readUInt32BE(16), 4096)
  assert.ok(body.length === 21 + 65 + payload.length + 1 + 16, 'body length = header + plaintext(data+0x02) + tag')

  const plain = decryptBody(body, clientEcdh, authSecret)
  assert.equal(plain[plain.length - 1], 0x02) // padding delimiter APPENDED
  assert.equal(plain.subarray(0, plain.length - 1).toString('utf8'), payload.toString('utf8'))
})

test('aes128gcm: encryptWithEcdh (test hook) produces the same wire format', () => {
  const clientEcdh = createECDH('prime256v1')
  clientEcdh.generateKeys()
  const authSecret = randomBytes(16)

  const serverEcdh = createECDH('prime256v1')
  serverEcdh.generateKeys()
  const payload = Buffer.from('x'.repeat(100))
  const { body } = encryptWithEcdh(serverEcdh, clientEcdh.getPublicKey(null, 'uncompressed'), authSecret, payload)
  const plain = decryptBody(body, clientEcdh, authSecret)
  assert.equal(plain.subarray(0, plain.length - 1).toString(), 'x'.repeat(100))
})

test('aes128gcm: rejects malformed subscription keys', () => {
  assert.throws(() => encryptPayload('too-short', base64url(randomBytes(16)), 'x'), /p256dh/)
  assert.throws(() => encryptPayload(base64url(Buffer.concat([Buffer.from([0x04]), randomBytes(64)])), 'bad', 'x'), /auth secret/)
})

// ------------------------------------------------------------------ send

test('sendPush: posts aes128gcm body with VAPID authorization', async () => {
  const keys = generateVapidKeys()
  const clientEcdh = createECDH('prime256v1')
  clientEcdh.generateKeys()
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, init })
    return { status: 201 }
  }
  const sub = {
    endpoint: 'https://push.example.com/wpush/v2/abc',
    keys: { p256dh: base64url(clientEcdh.getPublicKey(null, 'uncompressed')), auth: base64url(randomBytes(16)) },
  }
  const r = await sendPush({
    endpoint: sub.endpoint,
    keys: sub.keys,
    payload: Buffer.from('hi'),
    vapid: { publicKeyB64: keys.publicKeyB64, privateKey: keys.privateKey },
    subject: 'mailto:ops@example.com',
    fetchImpl: fakeFetch,
  })
  assert.equal(r.status, 'sent')
  assert.equal(calls.length, 1)
  const h = calls[0].init.headers
  assert.match(h.Authorization, /^vapid t=.*, k=.*$/)
  assert.equal(h['Content-Encoding'], 'aes128gcm')
  assert.equal(h.TTL, '86400')
  assert.equal(h.Urgency, 'normal')
  assert.ok(Buffer.isBuffer(calls[0].init.body))
})

test('sendPush: maps 404/410 to gone and network errors to failed', async () => {
  const keys = generateVapidKeys()
  const clientEcdh = createECDH('prime256v1')
  clientEcdh.generateKeys()
  const sub = {
    endpoint: 'https://push.example.com/wpush/v2/abc',
    keys: { p256dh: base64url(clientEcdh.getPublicKey(null, 'uncompressed')), auth: base64url(randomBytes(16)) },
  }
  const base = { endpoint: sub.endpoint, keys: sub.keys, payload: Buffer.from('x'), vapid: { publicKeyB64: keys.publicKeyB64, privateKey: keys.privateKey }, subject: 'mailto:a@b.c' }

  const r1 = await sendPush({ ...base, fetchImpl: async () => ({ status: 410 }) })
  assert.equal(r1.status, 'gone')
  const r2 = await sendPush({ ...base, fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(r2.status, 'failed')
  assert.match(r2.error, /network/)
})
