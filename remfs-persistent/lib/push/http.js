// push/http.js — node:http route handlers for the presence/push HTTP surface.
// Extracted as pure factories so they are unit-testable without a live server.
// Routes (registered on the harness webServer service by host.js):
//   GET /remfs-presence.json     → { ok, value:{ tasks, orb } }  (widget)
//   GET /remfs-sw.js             → service worker script         (phone)
//   GET /remfs-push-vapid.json   → { publicKey }                 (phone)

function send(res, status, body, contentType, extraHeaders = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  const headers = {
    'Content-Type': contentType,
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  }
  res.writeHead(status, headers)
  res.end(buf)
}

export function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8')
}

/**
 * Build the three route handlers.
 * @param {Object} deps
 * @param {() => Promise<any>} deps.tasks - presence.tasks() (or a wrapper).
 * @param {(deviceId: string, credential: string) => Promise<{error?: string}>} deps.verifyDevice
 * @param {boolean} deps.pocketStrict - when true, presence.json requires a valid device.
 * @param {() => Promise<{publicKeyB64: string}>} deps.vapidPublic
 * @param {string} deps.swSource - the service worker script text.
 */
export function createHttpHandlers(deps) {
  const { tasks, verifyDevice, pocketStrict, vapidPublic, swSource } = deps

  async function handlePresenceJson(req, res) {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET only', details: {} } })
      return
    }
    if (pocketStrict) {
      const deviceId = String(req.headers['x-remfs-device-id'] || '')
      const credential = String(req.headers['x-remfs-credential'] || '')
      const auth = await verifyDevice(deviceId, credential)
      if (auth.error) {
        sendJson(res, 403, { ok: false, error: { code: 'auth-invalid', message: 'device authentication failed', details: {} } })
        return
      }
    }
    try {
      const r = await tasks()
      sendJson(res, 200, r)
    } catch (e) {
      sendJson(res, 500, { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } })
    }
  }

  async function handleSw(req, res) {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET only', details: {} } })
      return
    }
    send(res, 200, swSource, 'text/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' })
  }

  async function handleVapidPublic(req, res) {
    if ((req.method || 'GET').toUpperCase() !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET only', details: {} } })
      return
    }
    try {
      const v = await vapidPublic()
      sendJson(res, 200, { ok: true, value: v })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: { code: 'internal', message: String((e && e.message) || e), details: {} } })
    }
  }

  return {
    handlePresenceJson,
    handleSw,
    handleVapidPublic,
  }
}

/** Minimal node:http-like res mock for tests (collects the response). */
export function mockRes() {
  const state = { status: 0, headers: {}, body: null }
  return {
    state,
    writeHead(status, headers) { state.status = status; Object.assign(state.headers, headers || {}) },
    end(body) { state.body = body === undefined ? null : body },
  }
}
