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
  // No device headers => the caller is simply unauthenticated (verifyDevice is
  // not consulted for empty credentials). A WRONG device credential must still
  // fall through to verifyDevice and be denied - an invalid companion token
  // can never be upgraded by failing device auth.
  assert.equal(deviceChecks(), 0)
  const res2 = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: {
    'x-remfs-companion-token': '00'.repeat(32),
    'x-remfs-device-id': 'phone', 'x-remfs-credential': 'wrong',
  } }, res2)
  assert.equal(res2.state.status, 403)
  assert.equal(deviceChecks(), 1, 'a failing device credential must be consulted and denied')
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

// ---------------------------------------------------------------- F5 redaction
// Outside pocketStrict the endpoint still answers unauthenticated GETs (PC
// widget / Task Board), but task title/summary must be redacted unless the
// caller proves a valid device credential OR the local companion token.

const TASK = {
  taskId: 't', sessionId: 's', title: 'SECRET TITLE', state: 'RUNNING',
  summary: 'secret progress', systemHeartbeatAt: '2026-01-01T00:00:00.000Z',
  progressHeartbeatAt: null, startedAt: 1, updatedAt: 2, attention: null,
  staleReason: ['no meaningful progress for 21m'], sizeBytes: 4242,
}

test('presence HTTP: non-strict unauthenticated response is redacted (F5)', async () => {
  const { api, deviceChecks } = handlers({
    pocketStrict: false,
    tasks: async () => ({ ok: true, value: { tasks: [TASK], orb: TASK } }),
  })
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: {} }, res)
  assert.equal(res.state.status, 200, 'non-strict mode must not 403 the widget')
  const body = String(res.state.body)
  const out = JSON.parse(body)
  assert.equal(out.value.tasks[0].title, '(paired)')
  assert.equal(out.value.tasks[0].summary, '')
  assert.equal(out.value.tasks[0].taskId, 't')
  assert.equal(out.value.tasks[0].state, 'RUNNING')
  assert.deepEqual(out.value.tasks[0].staleReason, TASK.staleReason)
  assert.equal(out.value.tasks[0].sizeBytes, 4242)
  assert.equal(out.value.orb.title, '(paired)')
  assert.ok(!body.includes('SECRET'), 'no user content may reach an unauthenticated caller')
})

test('presence HTTP: non-strict valid device headers get full content (F5)', async () => {
  const { api } = handlers({
    pocketStrict: false,
    tasks: async () => ({ ok: true, value: { tasks: [TASK], orb: null } }),
    verifyDevice: async (id, credential) =>
      id === 'phone' && credential === 'secret' ? { device: { id } } : { error: 'auth-invalid' },
  })
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: {
    'x-remfs-device-id': 'phone', 'x-remfs-credential': 'secret',
  } }, res)
  assert.equal(res.state.status, 200)
  const out = JSON.parse(String(res.state.body))
  assert.equal(out.value.tasks[0].title, 'SECRET TITLE')
  assert.equal(out.value.tasks[0].summary, 'secret progress')
})

test('presence HTTP: non-strict companion token gets full content (F5)', async () => {
  const { api, deviceChecks } = handlers({
    pocketStrict: false,
    tasks: async () => ({ ok: true, value: { tasks: [TASK], orb: null } }),
  })
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: { 'x-remfs-companion-token': TOKEN } }, res)
  assert.equal(res.state.status, 200)
  const out = JSON.parse(String(res.state.body))
  assert.equal(out.value.tasks[0].title, 'SECRET TITLE')
  assert.equal(deviceChecks(), 0, 'the companion token must not impersonate a paired device')
})

test('presence HTTP: non-strict invalid device headers are still redacted (F5)', async () => {
  const { api } = handlers({
    pocketStrict: false,
    tasks: async () => ({ ok: true, value: { tasks: [TASK], orb: null } }),
  })
  const res = mockRes()
  await api.handlePresenceJson({ method: 'GET', headers: {
    'x-remfs-device-id': 'phone', 'x-remfs-credential': 'wrong-secret',
  } }, res)
  assert.equal(res.state.status, 200)
  const out = JSON.parse(String(res.state.body))
  assert.equal(out.value.tasks[0].title, '(paired)', 'a failed credential must not unlock content')
  assert.equal(out.value.tasks[0].summary, '')
})
