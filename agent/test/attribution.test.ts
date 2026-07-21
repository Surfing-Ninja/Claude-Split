import { describe, expect, it } from 'vitest';
import { computeDelta, type Snapshot } from '../src/attribution.js';
import { parseUsageResponse } from '../src/claude-usage.js';

function snap(sessionPct: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    sessionPct,
    sessionResetAt: '2026-07-21T18:05:00.000Z',
    weekly: [
      { limitType: 'all_models', pct: sessionPct / 10, resetAt: '2026-07-27T00:00:00.000Z' },
    ],
    capturedAt: new Date().toISOString(),
    source: 'poll',
    ...overrides,
  };
}

describe('computeDelta (agent port — must match extension semantics)', () => {
  it('normal send produces session + weekly deltas', () => {
    const result = computeDelta(snap(0.2), snap(0.25));
    expect(result).toEqual({
      kind: 'delta',
      sessionDelta: 0.05,
      weeklyDeltas: [{ limitType: 'all_models', delta: 0.005 }],
    });
  });

  it('mid-flight reset discards the delta', () => {
    expect(computeDelta(snap(0.9), snap(0.01)).kind).toBe('reset');
    expect(
      computeDelta(snap(0.9), snap(0.91, { sessionResetAt: '2026-07-21T23:05:00.000Z' })).kind,
    ).toBe('reset');
  });

  it('unusable without both snapshots', () => {
    expect(computeDelta(null, snap(0.2)).kind).toBe('unusable');
  });
});

describe('parseUsageResponse (agent copy of the parser)', () => {
  it('parses the known /usage shape', () => {
    const parsed = parseUsageResponse({
      five_hour: { utilization: 23, resets_at: '2026-07-21T18:05:00+00:00' },
      seven_day: { utilization: 8, resets_at: '2026-07-27T00:00:00+00:00' },
    });
    expect(parsed?.sessionPct).toBe(0.23);
    expect(parsed?.weekly).toEqual([
      { limitType: 'all_models', pct: 0.08, resetAt: '2026-07-27T00:00:00.000Z' },
    ]);
  });

  it('fails soft on unknown shapes', () => {
    expect(parseUsageResponse({ nope: true })).toBeNull();
    expect(parseUsageResponse(null)).toBeNull();
  });
});
