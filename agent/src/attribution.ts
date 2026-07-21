// TypeScript port of the §8 attribution math (kept in sync with
// extension/src/lib/attribution.js — same semantics, same tests).

export type WeeklyWindow = { limitType: string; pct: number; resetAt: string | null };

export type Snapshot = {
  sessionPct: number;
  sessionResetAt: string | null;
  weekly: WeeklyWindow[];
  capturedAt: string;
  source: string;
};

export type DeltaResult =
  | { kind: 'unusable' }
  | { kind: 'reset'; resetAt: string | null }
  | {
      kind: 'delta';
      sessionDelta: number;
      weeklyDeltas: Array<{ limitType: string; delta: number }>;
    };

const RESET_TOLERANCE_MS = 60 * 1000;
const PCT_EPSILON = 1e-9;

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function sameWindow(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) < RESET_TOLERANCE_MS;
}

export function computeDelta(before: Snapshot | null, after: Snapshot | null): DeltaResult {
  if (!before || !after) return { kind: 'unusable' };

  const windowRolled = !sameWindow(before.sessionResetAt, after.sessionResetAt);
  const pctDropped = after.sessionPct < before.sessionPct - PCT_EPSILON;
  if (windowRolled || pctDropped) return { kind: 'reset', resetAt: after.sessionResetAt ?? null };

  const sessionDelta = round6(clamp01(after.sessionPct - before.sessionPct));
  const weeklyDeltas: Array<{ limitType: string; delta: number }> = [];
  for (const w of after.weekly ?? []) {
    const prev = (before.weekly ?? []).find((b) => b.limitType === w.limitType);
    if (!prev) continue;
    if (!sameWindow(prev.resetAt, w.resetAt)) continue;
    if (w.pct < prev.pct - PCT_EPSILON) continue;
    const delta = round6(clamp01(w.pct - prev.pct));
    if (delta > 0) weeklyDeltas.push({ limitType: w.limitType, delta });
  }
  return { kind: 'delta', sessionDelta, weeklyDeltas };
}
