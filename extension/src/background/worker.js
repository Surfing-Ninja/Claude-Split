// Background service worker: device identity, freshness polling, delta
// attribution (§8), offline-safe sync. All state survives worker restarts
// via chrome.storage.local (§14).

import { applyToLocalCounters, computeDelta, resetLocalCounters } from '../lib/attribution.js';
import { backend } from '../lib/backend.js';
import {
  DEFAULT_SETTINGS,
  KEYS,
  MAX_QUEUE_LENGTH,
  storeGet,
  storeRemove,
  storeSet,
} from '../lib/store.js';
import { mergeSnapshot, parseUsageResponse, usageUrlForOrg } from '../lib/usage-parser.js';

const POLL_ALARM = 'usage-poll';
const HOUSEKEEPING_ALARM = 'housekeeping';
const POLL_PERIOD_MIN = 3;
const SNAPSHOT_FRESH_MS = 60 * 1000; // §8: before-snapshot must be < 60s old
const PENDING_SEND_TIMEOUT_MS = 30 * 1000;
const MAX_POLL_FAILURES = 3;
const QUEUE_BACKOFF_START_MS = 30 * 1000;
const QUEUE_BACKOFF_MAX_MS = 15 * 60 * 1000;

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

async function init() {
  const state = await storeGet([KEYS.deviceId, KEYS.deviceName, KEYS.settings]);
  const patch = {};
  if (!state[KEYS.deviceId]) patch[KEYS.deviceId] = crypto.randomUUID();
  if (!state[KEYS.deviceName]) {
    const platform = await chrome.runtime.getPlatformInfo().catch(() => null);
    const browser = navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Chrome';
    patch[KEYS.deviceName] = `${browser} on ${platform?.os ?? 'unknown'}`;
  }
  if (!state[KEYS.settings]) patch[KEYS.settings] = { ...DEFAULT_SETTINGS };
  if (Object.keys(patch).length) await storeSet(patch);

  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
  await chrome.alarms.create(HOUSEKEEPING_ALARM, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollUsage('alarm');
  if (alarm.name === HOUSEKEEPING_ALARM) void housekeeping();
});

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = (promise) => {
    promise
      .then((result) => sendResponse(result ?? { ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
    return true; // async response
  };

  switch (message?.type) {
    // from the content script (bridge relays)
    case 'bridge:snapshot':
      return respond(handleSnapshot(message.payload));
    case 'bridge:snapshot-partial':
      return respond(handlePartialSnapshot(message.payload));
    case 'bridge:send-detected':
      return respond(handleSendDetected(message.payload));
    case 'bridge:org-id':
      return respond(storeSet({ [KEYS.claudeOrgId]: message.payload?.orgId }));
    case 'bridge:parse-miss':
      return respond(storeSet({ [KEYS.parserBroken]: true }));
    case 'bridge:bridge-ready':
      // a live claude.ai tab proves we're logged in again
      return respond(storeSet({ [KEYS.claudeLoggedOut]: false, [KEYS.pollFailures]: 0 }));

    // from the popup
    case 'popup:get-state':
      return respond(getPopupState());
    case 'popup:refresh':
      return respond(refresh());
    case 'popup:login':
      return respond(loginToBackend(message.payload));
    case 'popup:logout':
      return respond(logoutFromBackend());
    case 'popup:rename-device':
      return respond(renameDevice(message.payload?.name));
    case 'popup:set-settings':
      return respond(setSettings(message.payload));
    case 'popup:reset-local':
      return respond(resetLocalData());
    default:
      return false;
  }
});

// ---------- snapshots + attribution (§8) ----------

async function handleSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.sessionPct !== 'number') return;
  const state = await storeGet([KEYS.latestSnapshot, KEYS.localCounters, KEYS.pendingSend]);
  const previous = state[KEYS.latestSnapshot];

  // Snapshots from a live tab prove the claude.ai session works.
  const patch = {
    [KEYS.latestSnapshot]: snapshot,
    [KEYS.pollFailures]: 0,
    [KEYS.claudeLoggedOut]: false,
    [KEYS.parserBroken]: false,
  };

  const pending = state[KEYS.pendingSend];
  if (pending) {
    const resolved = resolvePendingSend(pending, snapshot, state[KEYS.localCounters]);
    if (resolved) Object.assign(patch, resolved);
  } else if (previous) {
    // No send in flight: still detect window rollover so counters restart.
    const change = computeDelta(previous, snapshot);
    if (change.kind === 'reset') {
      patch[KEYS.localCounters] = resetLocalCounters(snapshot);
    }
  }
  await storeSetWithQueue(patch);
  await flushQueue();
}

async function handlePartialSnapshot(partial) {
  const state = await storeGet([KEYS.latestSnapshot]);
  const merged = mergeSnapshot(state[KEYS.latestSnapshot], partial);
  await handleSnapshot(merged);
}

async function handleSendDetected(payload) {
  const at = payload?.at ?? new Date().toISOString();
  const state = await storeGet([KEYS.latestSnapshot, KEYS.pendingSend]);
  const latest = state[KEYS.latestSnapshot];
  const fresh = latest && Date.now() - new Date(latest.capturedAt).getTime() < SNAPSHOT_FRESH_MS;

  let before = fresh ? latest : null;
  if (!before) {
    // Stale baseline → force one poll now; /usage typically still reflects
    // the pre-send value while the completion streams.
    before = (await pollUsage('pre-send')) ?? latest ?? null;
  }

  const existing = state[KEYS.pendingSend];
  const pendingSend = existing
    ? // rapid successive sends coalesce: keep the earliest baseline so the
      // combined jump is attributed to this device once
      { ...existing, deadline: Date.now() + PENDING_SEND_TIMEOUT_MS }
    : {
        before,
        startedAt: at,
        deadline: Date.now() + PENDING_SEND_TIMEOUT_MS,
      };
  await storeSet({ [KEYS.pendingSend]: pendingSend });

  // Best-effort prompt resolution; housekeeping alarm is the durable fallback.
  setTimeout(() => void housekeeping(), PENDING_SEND_TIMEOUT_MS + 5000);
}

/**
 * Given the pending send and a new snapshot, decide whether to settle.
 * Returns a storage patch, or null to keep waiting.
 */
function resolvePendingSend(pending, snapshot, counters) {
  const before = pending.before;
  const timedOut = Date.now() > pending.deadline;
  const change = computeDelta(before, snapshot);

  if (change.kind === 'unusable') {
    // no usable baseline — drop the pending send, keep official numbers
    return timedOut ? { [KEYS.pendingSend]: null } : null;
  }
  if (change.kind === 'reset') {
    return {
      [KEYS.pendingSend]: null,
      [KEYS.localCounters]: resetLocalCounters(snapshot),
    };
  }
  const moved = change.sessionDelta > 0 || change.weeklyDeltas.length > 0;
  if (!moved && !timedOut) return null; // SSE snapshot for this send not seen yet

  const patch = { [KEYS.pendingSend]: null };
  if (moved) {
    patch[KEYS.localCounters] = applyToLocalCounters(counters, change, snapshot);
    patch.__enqueue = {
      occurredAt: pending.startedAt,
      sessionDelta: change.sessionDelta,
      weeklyDeltas: change.weeklyDeltas,
      sessionPctAfter: snapshot.sessionPct,
      sessionResetAt: snapshot.sessionResetAt ?? undefined,
      weeklySnapshots: (snapshot.weekly ?? []).map((w) => ({
        limitType: w.limitType,
        pct: w.pct,
        resetAt: w.resetAt,
      })),
    };
  }
  return patch;
}

// resolvePendingSend returns a plain storage patch plus an optional
// `__enqueue` pseudo-key; this wrapper turns that into a queue append so the
// whole settlement lands in one storage write.
async function storeSetWithQueue(patch) {
  if (patch && patch.__enqueue) {
    const event = patch.__enqueue;
    delete patch.__enqueue;
    const state = await storeGet([KEYS.eventQueue, KEYS.deviceId]);
    const queue = state[KEYS.eventQueue] ?? [];
    queue.push({
      idempotencyKey: crypto.randomUUID(),
      body: { deviceUuid: state[KEYS.deviceId], ...event },
    });
    while (queue.length > MAX_QUEUE_LENGTH) queue.shift();
    patch[KEYS.eventQueue] = queue;
  }
  return storeSet(patch);
}

// ---------- background freshness polling (§7.1) ----------

async function pollUsage(reason) {
  const state = await storeGet([KEYS.claudeLoggedOut, KEYS.pollFailures, KEYS.claudeOrgId]);
  if (state[KEYS.claudeLoggedOut] && reason === 'alarm') return null;

  const orgId = await resolveOrgId(state[KEYS.claudeOrgId]);
  if (!orgId) return null;

  let response;
  try {
    response = await fetch(usageUrlForOrg(orgId), { credentials: 'include' });
  } catch {
    return null; // offline — try again next alarm
  }

  if (response.status === 401 || response.status === 403) {
    const failures = (state[KEYS.pollFailures] ?? 0) + 1;
    // Back off politely: stop hammering the endpoint once clearly logged out.
    await storeSet({
      [KEYS.pollFailures]: failures,
      [KEYS.claudeLoggedOut]: failures >= MAX_POLL_FAILURES,
    });
    return null;
  }
  if (!response.ok) return null;

  let json = null;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  const snapshot = parseUsageResponse(json, 'poll');
  if (!snapshot) {
    await storeSet({ [KEYS.parserBroken]: true });
    return null;
  }
  await handleSnapshot(snapshot);
  return snapshot;
}

async function resolveOrgId(cached) {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' });
    if (cookie?.value) {
      if (cookie.value !== cached) await storeSet({ [KEYS.claudeOrgId]: cookie.value });
      return cookie.value;
    }
  } catch {
    // cookies API unavailable — fall back to cached value from the bridge
  }
  return cached ?? null;
}

// ---------- housekeeping: pending-send timeouts + queue flush ----------

async function housekeeping() {
  const state = await storeGet([KEYS.pendingSend, KEYS.latestSnapshot, KEYS.localCounters]);
  const pending = state[KEYS.pendingSend];
  if (pending && Date.now() > pending.deadline) {
    // §8: timeout 30s → fall back to one forced poll, then settle either way.
    const polled = await pollUsage('pending-timeout');
    const latest = polled ?? state[KEYS.latestSnapshot];
    if (latest) {
      const stillPending = (await storeGet([KEYS.pendingSend]))[KEYS.pendingSend];
      if (stillPending) {
        const resolved = resolvePendingSend(
          { ...stillPending, deadline: 0 },
          latest,
          state[KEYS.localCounters],
        );
        if (resolved) await storeSetWithQueue(resolved);
      }
    } else {
      await storeSet({ [KEYS.pendingSend]: null });
    }
  }
  await flushQueue();
}

// ---------- backend sync (§7.2 client side) ----------

async function ensureDeviceRegistered(auth) {
  const state = await storeGet([KEYS.deviceId, KEYS.deviceName, KEYS.deviceRegistered]);
  const fingerprint = `${auth.backendUrl}|${auth.token.slice(0, 8)}|${state[KEYS.deviceId]}`;
  if (state[KEYS.deviceRegistered] === fingerprint) return true;
  const result = await backend.registerDevice(auth, {
    deviceUuid: state[KEYS.deviceId],
    name: state[KEYS.deviceName] ?? 'Browser',
    kind: 'browser',
  });
  if (result.ok) {
    await storeSet({ [KEYS.deviceRegistered]: fingerprint });
    return true;
  }
  if (result.status === 401) await storeSet({ [KEYS.authError]: true });
  return false;
}

async function flushQueue() {
  const state = await storeGet([KEYS.auth, KEYS.eventQueue, KEYS.queueBackoff, KEYS.authError]);
  const auth = state[KEYS.auth];
  const queue = state[KEYS.eventQueue] ?? [];
  if (!auth?.token || queue.length === 0) return;
  const backoffState = state[KEYS.queueBackoff];
  if (backoffState && Date.now() < backoffState.nextAttemptAt) return;

  if (!(await ensureDeviceRegistered(auth))) return;

  const remaining = [...queue];
  while (remaining.length > 0) {
    const item = remaining[0];
    const result = await backend.logEvent(auth, item.body, item.idempotencyKey);
    if (result.ok) {
      remaining.shift();
      continue;
    }
    if (result.status === 401) {
      await storeSet({ [KEYS.authError]: true, [KEYS.eventQueue]: remaining });
      return;
    }
    if (result.status === 400 || result.status === 404) {
      // permanently rejected (schema drift / deleted device) — drop it
      remaining.shift();
      continue;
    }
    // network / 5xx / 429 → retry later with backoff
    const delayMs = Math.min(
      (backoffState?.delayMs ?? QUEUE_BACKOFF_START_MS / 2) * 2,
      QUEUE_BACKOFF_MAX_MS,
    );
    await storeSet({
      [KEYS.eventQueue]: remaining,
      [KEYS.queueBackoff]: { nextAttemptAt: Date.now() + delayMs, delayMs },
    });
    return;
  }
  await storeSet({ [KEYS.eventQueue]: [], [KEYS.queueBackoff]: null, [KEYS.authError]: false });
  await refreshSummary(auth);
}

async function refreshSummary(auth) {
  const result = await backend.summary(auth);
  if (result.ok) {
    await storeSet({ [KEYS.summary]: { data: result.json, fetchedAt: new Date().toISOString() } });
  } else if (result.status === 401) {
    await storeSet({ [KEYS.authError]: true });
  }
}

// ---------- popup handlers ----------

async function getPopupState() {
  const state = await storeGet(Object.values(KEYS));
  return {
    ok: true,
    deviceId: state[KEYS.deviceId],
    deviceName: state[KEYS.deviceName],
    snapshot: state[KEYS.latestSnapshot] ?? null,
    localCounters: state[KEYS.localCounters] ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(state[KEYS.settings] ?? {}) },
    auth: state[KEYS.auth]
      ? { backendUrl: state[KEYS.auth].backendUrl, email: state[KEYS.auth].email }
      : null,
    authError: Boolean(state[KEYS.authError]),
    summary: state[KEYS.summary] ?? null,
    queueLength: (state[KEYS.eventQueue] ?? []).length,
    claudeLoggedOut: Boolean(state[KEYS.claudeLoggedOut]),
    parserBroken: Boolean(state[KEYS.parserBroken]),
  };
}

async function refresh() {
  await pollUsage('manual');
  const state = await storeGet([KEYS.auth]);
  if (state[KEYS.auth]?.token) {
    await flushQueue();
    await refreshSummary(state[KEYS.auth]);
  }
  return getPopupState();
}

async function loginToBackend({ backendUrl, email, password, mode }) {
  const url = String(backendUrl ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
    return { ok: false, error: 'backend URL must be https:// (or http://localhost for testing)' };
  }
  const result =
    mode === 'register'
      ? await backend.register(url, email, password)
      : await backend.login(url, email, password);
  if (!result.ok) {
    return { ok: false, error: result.error ?? `login failed (${result.status})` };
  }
  const auth = { backendUrl: url, token: result.json.token, email };
  await storeSet({ [KEYS.auth]: auth, [KEYS.authError]: false, [KEYS.deviceRegistered]: null });
  await ensureDeviceRegistered(auth);
  // adopt server-side settings so thresholds follow the account
  const settings = await backend.getSettings(auth);
  if (settings.ok) {
    const thresholds = { ...settings.json };
    delete thresholds.retentionDays;
    await storeSet({ [KEYS.settings]: { ...DEFAULT_SETTINGS, ...thresholds } });
  }
  await flushQueue();
  await refreshSummary(auth);
  return getPopupState();
}

async function logoutFromBackend() {
  const state = await storeGet([KEYS.auth]);
  if (state[KEYS.auth]?.token) {
    await backend.logout(state[KEYS.auth]).catch(() => {});
  }
  await storeRemove([KEYS.auth, KEYS.summary, KEYS.deviceRegistered, KEYS.authError]);
  return getPopupState();
}

async function renameDevice(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, error: 'name required' };
  await storeSet({ [KEYS.deviceName]: trimmed });
  const state = await storeGet([KEYS.auth, KEYS.summary, KEYS.deviceId]);
  const auth = state[KEYS.auth];
  const summaryDevices = state[KEYS.summary]?.data?.devices ?? [];
  const own = summaryDevices.find((d) => d.deviceUuid === state[KEYS.deviceId]);
  if (auth?.token && own) {
    await backend.renameDevice(auth, own.id, trimmed);
    await refreshSummary(auth);
  }
  return getPopupState();
}

async function setSettings(patch) {
  const state = await storeGet([KEYS.settings, KEYS.auth]);
  const merged = { ...DEFAULT_SETTINGS, ...(state[KEYS.settings] ?? {}), ...(patch ?? {}) };
  await storeSet({ [KEYS.settings]: merged });
  if (state[KEYS.auth]?.token) {
    await backend.patchSettings(state[KEYS.auth], patch ?? {});
  }
  return getPopupState();
}

async function resetLocalData() {
  await storeRemove([
    KEYS.localCounters,
    KEYS.pendingSend,
    KEYS.eventQueue,
    KEYS.queueBackoff,
    KEYS.latestSnapshot,
    KEYS.summary,
    KEYS.parserBroken,
    KEYS.bypassUntil,
  ]);
  return getPopupState();
}
