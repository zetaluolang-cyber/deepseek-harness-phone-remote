// One-off interop check: our RFC 8291 receiver-side derivation must decrypt
// what the reference `web-push` package encrypts. Run:
//   node scripts/interop-webpush-check.mjs <path-to-web-push-package>
import { createECDH, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

const pkgRoot = process.argv[2]
if (!pkgRoot) { console.error('usage: node scripts/interop-webpush-check.mjs <web-push-package-dir>'); process.exit(2) }
const require = createRequire(import.meta.url)
const wp = require(path.join(pkgRoot, 'node_modules', 'web-push'))
console.log('web-push exports:', Object.keys(wp).join(', '))

// Locate the encryption helper (internal API).
const encPath = [
  path.join(pkgRoot, 'node_modules', 'web-push', 'lib', 'encryption-helper.js'),
  path.join(pkgRoot, 'node_modules', 'web-push', 'src', 'encryption-helper.js'),
].find((p) => { try { require.resolve(p); return true } catch { return false } })
if (!encPath) { console.error('encryption-helper not found'); process.exit(2) }
const enc = require(encPath)
console.log('encryption-helper exports:', Object.keys(enc).join(', '))

// Client side (the browser): an ECDH keypair + auth secret.
const client = createECDH('prime256v1')
client.generateKeys()
const clientPub = client.getPublicKey(null, 'uncompressed')
const auth = randomBytes(16)
const payload = Buffer.from(JSON.stringify({ title: '互操作测试', body: 'hello world — 你好' }), 'utf8')

// Reference sender: web-push encrypts with OUR client key + auth.
// Keys must be base64url (web-push decodes with 'base64url').
const ref = enc.encrypt(
  client.getPublicKey(null, 'uncompressed').toString('base64url'),
  auth.toString('base64url'),
  payload,
  'aes128gcm',
)
console.log('reference sender fields:', Object.keys(ref).join(', '))

// Our receiver: reverse RFC 8291 with the reference ciphertext.
// NOTE: web-push's `cipherText` is the FULL aes128gcm body (header + record),
// so strip the 86-octet header before splitting ciphertext/tag.
const salt = Buffer.from(ref.salt, 'base64url')
const serverPub = Buffer.from(ref.localPublicKey, 'base64url')
const body = Buffer.from(ref.cipherText, 'base64url')
const idlen = body[20]
const headerLen = 21 + idlen
if (headerLen !== 86) throw new Error('unexpected aes128gcm header length ' + headerLen)
const ciphertext = body.subarray(headerLen) // ciphertext + 16-byte tag
const shared = client.computeSecret(serverPub)
const prkKey = createHmac('sha256', auth).update(shared).digest()
const keyInfo = Buffer.concat([
  Buffer.from('WebPush: info', 'ascii'),
  Buffer.from([0x00]),
  clientPub,
  serverPub,
])
const ikm = createHmac('sha256', prkKey).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest().subarray(0, 32)
const prk = createHmac('sha256', salt).update(ikm).digest()
const cek = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).digest().subarray(0, 16)
const nonce = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).digest().subarray(0, 12)
const ct = ciphertext.subarray(0, ciphertext.length - 16)
const tag = ciphertext.subarray(ciphertext.length - 16)
const d = createDecipheriv('aes-128-gcm', cek, nonce, { authTagLength: 16 })
d.setAuthTag(tag) // RFC 8188: AAD is empty
const plain = Buffer.concat([d.update(ct), d.final()])
console.log('plain[last] (expect 2):', plain[plain.length - 1])
console.log('decrypted === payload:', plain.subarray(0, plain.length - 1).toString('utf8') === payload.toString('utf8'))
if (plain.subarray(0, plain.length - 1).toString('utf8') !== payload.toString('utf8')) process.exit(1)
console.log('INTEROP OK: our RFC 8291 derivation decrypts reference ciphertext')
