// Thin promise wrapper + single source of truth for storage keys.
// MV3 service workers are killed aggressively (§14): every piece of state
// lives in chrome.storage.local, never in worker memory alone.

export const KEYS = {
  deviceId: 'deviceId',
  deviceName: 'deviceName',
  latestSnapshot: 'latestSnapshot', // canonical UsageSnapshot (official numbers)
  localCounters: 'localCounters', // this device's attributed usage
  pendingSend: 'pendingSend', // {before, startedAt, deadline}
  eventQueue: 'eventQueue', // offline-safe upload queue
  queueBackoff: 'queueBackoff', // {nextAttemptAt, delayMs}
  auth: 'auth', // {backendUrl, token, email}
  authError: 'authError', // backend rejected our token
  deviceRegistered: 'deviceRegistered', // fingerprint of last successful registration
  settings: 'settings', // thresholds (synced with backend when logged in)
  summary: 'summary', // last GET /usage/summary payload + fetchedAt
  claudeOrgId: 'claudeOrgId',
  pollFailures: 'pollFailures',
  claudeLoggedOut: 'claudeLoggedOut',
  parserBroken: 'parserBroken',
  bypassUntil: 'bypassUntil', // "Send anyway" override expiry (ms epoch)
  lastSendAt: 'lastSendAt', // last completion POST observed (diagnostics)
};

export const DEFAULT_SETTINGS = {
  warnSession: 0.9,
  blockSession: 0.98,
  warnWeekly: 0.9,
  blockWeekly: 0.98,
  hardBlockEnabled: true,
};

export const MAX_QUEUE_LENGTH = 500;

export async function storeGet(keys) {
  return chrome.storage.local.get(keys);
}

export async function storeSet(patch) {
  return chrome.storage.local.set(patch);
}

export async function storeRemove(keys) {
  return chrome.storage.local.remove(keys);
}
