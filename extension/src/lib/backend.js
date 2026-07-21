// Claude Split backend API client (extension side).
// Only usage numbers, device names, and timestamps ever travel here —
// never Claude credentials or conversation content (§7.3 hard rule).

async function call(backendUrl, path, { method = 'GET', token, body, idempotencyKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let response;
  try {
    response = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message ?? err), networkError: true };
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    // empty or non-JSON body
  }
  return { ok: response.ok, status: response.status, json, error: json?.error };
}

export const backend = {
  register: (backendUrl, email, password) =>
    call(backendUrl, '/auth/register', { method: 'POST', body: { email, password } }),
  login: (backendUrl, email, password) =>
    call(backendUrl, '/auth/login', { method: 'POST', body: { email, password } }),
  logout: (auth) => call(auth.backendUrl, '/auth/logout', { method: 'POST', token: auth.token }),
  registerDevice: (auth, device) =>
    call(auth.backendUrl, '/devices/register', { method: 'POST', token: auth.token, body: device }),
  renameDevice: (auth, deviceId, name) =>
    call(auth.backendUrl, `/devices/${deviceId}`, {
      method: 'PATCH',
      token: auth.token,
      body: { name },
    }),
  logEvent: (auth, event, idempotencyKey) =>
    call(auth.backendUrl, '/usage/log', {
      method: 'POST',
      token: auth.token,
      body: event,
      idempotencyKey,
    }),
  summary: (auth) => call(auth.backendUrl, '/usage/summary', { token: auth.token }),
  getSettings: (auth) => call(auth.backendUrl, '/settings', { token: auth.token }),
  patchSettings: (auth, patch) =>
    call(auth.backendUrl, '/settings', { method: 'PATCH', token: auth.token, body: patch }),
};
