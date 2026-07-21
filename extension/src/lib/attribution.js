// Pure attribution math (§8) — shared by the background worker and tests.
// Deltas are computed from Claude's own before/after numbers; Claude's live
// pct stays the source of truth for totals.

const RESET_TOLERANCE_MS = 60 * 1000;
const PCT_EPSILON = 1e-9;

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function sameWindow(a, b) {
  if (!a || !b) return true; // missing reset info → assume same window
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) < RESET_TOLERANCE_MS;
}

/**
 * @param {object|null} before snapshot at send time
 * @param {object|null} after  next snapshot after the send
 * @returns {{kind: 'unusable'} | {kind: 'reset', resetAt: string|null} |
 *   {kind: 'delta', sessionDelta: number,
 *    weeklyDeltas: Array<{limitType: string, delta: number}>}}
 */
export function computeDelta(before, after) {
  if (!before || !after) return { kind: 'unusable' };

  const windowRolled = !sameWindow(before.sessionResetAt, after.sessionResetAt);
  const pctDropped = after.sessionPct < before.sessionPct - PCT_EPSILON;
  if (windowRolled || pctDropped) {
    // Session rolled over mid-flight (§8): discard the delta entirely.
    return { kind: 'reset', resetAt: after.sessionResetAt ?? null };
  }

  const sessionDelta = round6(clamp01(after.sessionPct - before.sessionPct));
  const weeklyDeltas = [];
  for (const w of after.weekly ?? []) {
    const prev = (before.weekly ?? []).find((b) => b.limitType === w.limitType);
    if (!prev) continue; // new bucket appeared mid-send — no baseline, skip
    if (!sameWindow(prev.resetAt, w.resetAt)) continue; // weekly rolled — skip
    if (w.pct < prev.pct - PCT_EPSILON) continue; // decreased → rollover artifact
    const delta = round6(clamp01(w.pct - prev.pct));
    if (delta > 0) weeklyDeltas.push({ limitType: w.limitType, delta });
  }
  return { kind: 'delta', sessionDelta, weeklyDeltas };
}

/**
 * Fold a computed delta into this device's local cumulative counters,
 * restarting any counter whose window rolled over.
 */
export function applyToLocalCounters(counters, delta, after) {
  const next = {
    sessionResetAt: after.sessionResetAt ?? counters?.sessionResetAt ?? null,
    sessionPct: counters?.sessionPct ?? 0,
    weekly: { ...(counters?.weekly ?? {}) },
  };
  if (!sameWindow(counters?.sessionResetAt, after.sessionResetAt)) {
    next.sessionPct = 0;
    next.sessionResetAt = after.sessionResetAt ?? null;
  }
  next.sessionPct = round6(next.sessionPct + delta.sessionDelta);

  for (const { limitType, delta: d } of delta.weeklyDeltas) {
    const afterWin = (after.weekly ?? []).find((w) => w.limitType === limitType);
    const existing = next.weekly[limitType];
    const rolled = existing && !sameWindow(existing.resetAt, afterWin?.resetAt);
    const base = rolled || !existing ? 0 : existing.pct;
    next.weekly[limitType] = {
      pct: round6(base + d),
      resetAt: afterWin?.resetAt ?? existing?.resetAt ?? null,
    };
  }
  return next;
}

/** Zero local counters at a reset (§8 reset handling). */
export function resetLocalCounters(after) {
  return {
    sessionResetAt: after?.sessionResetAt ?? null,
    sessionPct: 0,
    weekly: {},
  };
}
