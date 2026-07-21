// Claude endpoint knowledge lives HERE and in injected/bridge.js only (§7.1).
// When Anthropic changes their frontend, these two files are the fix surface.
//
// Interception technique credit: she-llac/claude-counter (MIT) — see NOTICES.md.
//
// Observed surfaces:
//   GET  https://claude.ai/api/organizations/{orgId}/usage
//        → { five_hour: {utilization, resets_at}, seven_day: {...},
//            seven_day_sonnet?: {...}, seven_day_opus?: {...}, ... }
//        utilization is a percentage (0–100, sometimes fractional); some
//        deployments have used 0–1 floats — both are normalized to 0..1.
//   POST https://claude.ai/api/organizations/{orgId}/chat_conversations/{id}/completion
//        → one real user send; the SSE response stream can carry
//          `message_limit` events with live utilization data.

export const USAGE_PATH_RE = /^\/api\/organizations\/([^/]+)\/usage(?:\?|$)/;
export const COMPLETION_PATH_RE =
  /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(?:retry_)?completion(?:\?|$)/;

const SESSION_KEY = 'five_hour';
const WEEKLY_KEY_PREFIX = 'seven_day';

export function isUsageUrl(url) {
  const path = toPath(url);
  return path != null && USAGE_PATH_RE.test(path);
}

export function isCompletionUrl(url) {
  const path = toPath(url);
  return path != null && COMPLETION_PATH_RE.test(path);
}

export function orgIdFromUsageUrl(url) {
  const path = toPath(url);
  const m = path?.match(USAGE_PATH_RE);
  return m ? m[1] : null;
}

export function usageUrlForOrg(orgId) {
  return `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`;
}

function toPath(url) {
  try {
    return (
      new URL(url, 'https://claude.ai').pathname + (new URL(url, 'https://claude.ai').search || '')
    );
  } catch {
    return null;
  }
}

/** Accepts 0–1 floats or 0–100 percentages; returns 0..1 or null. */
export function normalizePct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, pct));
}

function normalizeResetAt(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readWindow(obj) {
  if (obj == null || typeof obj !== 'object') return null;
  const pct = normalizePct(obj.utilization ?? obj.pct ?? obj.percentage);
  const resetAt = normalizeResetAt(obj.resets_at ?? obj.resetsAt ?? obj.reset_at ?? obj.resetAt);
  if (pct == null) return null;
  return { pct, resetAt };
}

/**
 * Parse a `/usage` response body into a normalized UsageSnapshot, or null if
 * the shape is unrecognized (fail soft — caller surfaces "update needed").
 *
 * @returns {null | {
 *   sessionPct: number, sessionResetAt: string|null,
 *   weekly: Array<{limitType: string, pct: number, resetAt: string|null}>,
 *   capturedAt: string, source: string,
 * }}
 */
export function parseUsageResponse(json, source = 'fetch', now = new Date()) {
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return null;

  const session = readWindow(json[SESSION_KEY]);
  const weekly = [];
  for (const [key, value] of Object.entries(json)) {
    if (key === SESSION_KEY || !key.startsWith(WEEKLY_KEY_PREFIX)) continue;
    const win = readWindow(value);
    if (!win) continue;
    const limitType =
      key === WEEKLY_KEY_PREFIX ? 'all_models' : key.slice(WEEKLY_KEY_PREFIX.length + 1);
    weekly.push({ limitType, ...win });
  }

  if (!session && weekly.length === 0) return null;
  return {
    sessionPct: session?.pct ?? 0,
    sessionResetAt: session?.resetAt ?? null,
    weekly,
    capturedAt: now.toISOString(),
    source,
  };
}

/**
 * Extract live usage data from one SSE event payload (already JSON-parsed).
 * claude.ai pushes `message_limit` events during completions with exact,
 * unrounded utilization. Returns a *partial* snapshot to merge over the last
 * full one, or null when the event carries nothing usable.
 */
export function parseSseEvent(json, now = new Date()) {
  if (json == null || typeof json !== 'object') return null;
  if (json.type !== 'message_limit') return null;
  const payload = json.message_limit ?? json;
  if (payload == null || typeof payload !== 'object') return null;

  const win = readWindow(payload);
  const partial = {};
  if (win) {
    partial.sessionPct = win.pct;
    if (win.resetAt) partial.sessionResetAt = win.resetAt;
  }
  // Some payload variants nest per-window data the same way /usage does.
  const nested = parseUsageResponse(payload, 'sse', now);
  if (nested) {
    partial.sessionPct = nested.sessionPct;
    partial.sessionResetAt = nested.sessionResetAt ?? partial.sessionResetAt ?? null;
    partial.weekly = nested.weekly;
  }
  if (Object.keys(partial).length === 0) return null;
  return { ...partial, capturedAt: now.toISOString(), source: 'sse' };
}

/** Split raw SSE text chunks into `data:` JSON payloads; tolerant of noise. */
export function* sseDataPayloads(rawText) {
  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const body = line.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    try {
      yield JSON.parse(body);
    } catch {
      // partial chunk or non-JSON data line — skip
    }
  }
}

/** Merge a partial (SSE) update over the previous full snapshot. */
export function mergeSnapshot(previous, partial) {
  if (!partial) return previous;
  const base = previous ?? { sessionPct: 0, sessionResetAt: null, weekly: [] };
  return {
    sessionPct: partial.sessionPct ?? base.sessionPct,
    sessionResetAt: partial.sessionResetAt ?? base.sessionResetAt,
    weekly: partial.weekly ?? base.weekly,
    capturedAt: partial.capturedAt ?? base.capturedAt,
    source: partial.source ?? base.source,
  };
}
