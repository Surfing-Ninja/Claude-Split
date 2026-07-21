import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyToLocalCounters, computeDelta, resetLocalCounters } from '../src/lib/attribution.js';

const RESET = '2026-07-21T18:05:00.000Z';
const WEEK_RESET = '2026-07-27T00:00:00.000Z';

function snap(sessionPct, overrides = {}) {
  return {
    sessionPct,
    sessionResetAt: RESET,
    weekly: [{ limitType: 'all_models', pct: sessionPct / 10, resetAt: WEEK_RESET }],
    capturedAt: new Date().toISOString(),
    source: 'fetch',
    ...overrides,
  };
}

describe('computeDelta', () => {
  it('computes session + weekly deltas for a normal send', () => {
    const result = computeDelta(snap(0.2), snap(0.25));
    assert.equal(result.kind, 'delta');
    assert.equal(result.sessionDelta, 0.05);
    assert.deepEqual(result.weeklyDeltas, [{ limitType: 'all_models', delta: 0.005 }]);
  });

  it('discards the delta when the session reset mid-flight (pct dropped)', () => {
    const result = computeDelta(snap(0.9), snap(0.01));
    assert.equal(result.kind, 'reset');
  });

  it('discards the delta when resetAt moved to a new window', () => {
    const after = snap(0.02, { sessionResetAt: '2026-07-21T23:05:00.000Z' });
    const result = computeDelta(snap(0.9), after);
    assert.equal(result.kind, 'reset');
    assert.equal(result.resetAt, '2026-07-21T23:05:00.000Z');
  });

  it('tolerates sub-minute resetAt jitter', () => {
    const after = snap(0.25, { sessionResetAt: '2026-07-21T18:05:30.000Z' });
    assert.equal(computeDelta(snap(0.2), after).kind, 'delta');
  });

  it('skips weekly buckets whose window rolled over', () => {
    const after = snap(0.25);
    after.weekly = [{ limitType: 'all_models', pct: 0.001, resetAt: '2026-08-03T00:00:00Z' }];
    const result = computeDelta(snap(0.2), after);
    assert.equal(result.kind, 'delta');
    assert.deepEqual(result.weeklyDeltas, []);
  });

  it('never produces negative deltas and is unusable without both snapshots', () => {
    const same = computeDelta(snap(0.2), snap(0.2));
    assert.equal(same.sessionDelta, 0);
    assert.equal(computeDelta(null, snap(0.2)).kind, 'unusable');
    assert.equal(computeDelta(snap(0.2), null).kind, 'unusable');
  });
});

describe('local counters', () => {
  it('accumulates across sends within one window', () => {
    let counters = resetLocalCounters(snap(0));
    counters = applyToLocalCounters(
      counters,
      { sessionDelta: 0.05, weeklyDeltas: [{ limitType: 'all_models', delta: 0.005 }] },
      snap(0.05),
    );
    counters = applyToLocalCounters(
      counters,
      { sessionDelta: 0.07, weeklyDeltas: [{ limitType: 'all_models', delta: 0.007 }] },
      snap(0.12),
    );
    assert.equal(counters.sessionPct, 0.12);
    assert.equal(counters.weekly.all_models.pct, 0.012);
  });

  it('restarts the session counter when the window changes', () => {
    let counters = resetLocalCounters(snap(0));
    counters = applyToLocalCounters(counters, { sessionDelta: 0.5, weeklyDeltas: [] }, snap(0.5));
    const newWindow = snap(0.02, { sessionResetAt: '2026-07-21T23:05:00.000Z' });
    counters = applyToLocalCounters(counters, { sessionDelta: 0.02, weeklyDeltas: [] }, newWindow);
    assert.equal(counters.sessionPct, 0.02);
    assert.equal(counters.sessionResetAt, '2026-07-21T23:05:00.000Z');
  });
});
