import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHandlers, mockRes } from '../lib/push/http.js'

const TOKEN = 'ab'.repeat(32)

function handlers(overrides = {}) {
  let deviceChecks = 0
  const api = createHttpHandlers({
    tasks: async () => ({ ok: true, value: { tasks: [] } }),
    verifyDevice: async () => { deviceChecks++; return { error: 'auth-invalid' } },
    pocketStrict: true,
    companionToken: async () => TOKEN,
    vapidPublic: async () => ({ publicKeyB64: 'x' }),
    swSource: '',
    ...overrides,
  })
  return { api, deviceChecks: () => deviceChecks }
}

test('presence HTTP: strict mode accepts the local read-only companion token', async () => {
  const { api, deviceChecks } = handlers()
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: { 'x-remfs-companion-token': TOKEN } }, res)
  assert.equal(res.state.status, 200)
  assert.equal(deviceChecks(), 0, 'local companion token must not impersonate a paired device')
  assert.deepEqual(JSON.parse(String(res.state.body)), { ok: true, value: { tasks: [] } })
})

test('presence HTTP: an invalid companion token never bypasses device auth', async () => {
  const { api, deviceChecks } = handlers()
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: { 'x-remfs-companion-token': '00'.repeat(32) } }, res)
  assert.equal(res.state.status, 403)
  assert.equal(deviceChecks(), 1)
})

test('presence HTTP: valid paired-device headers still work in strict mode', async () => {
  const { api } = handlers({ verifyDevice: async (id, credential) =>
    id === 'phone' && credential === 'secret' ? { device: { id } } : { error: 'auth-invalid' } })
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: {
    'x-remfs-device-id': 'phone', 'x-remfs-credential': 'secret',
  } }, res)
  assert.equal(res.state.status, 200)
})
