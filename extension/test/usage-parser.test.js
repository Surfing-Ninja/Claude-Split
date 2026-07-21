import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isCompletionUrl,
  isUsageUrl,
  mergeSnapshot,
  normalizePct,
  orgIdFromUsageUrl,
  parseSseEvent,
  parseUsageResponse,
  sseDataPayloads,
} from '../src/lib/usage-parser.js';

const USAGE_FIXTURE = {
  five_hour: { utilization: 23, resets_at: '2026-07-21T18:05:00+00:00' },
  seven_day: { utilization: 8, resets_at: '2026-07-27T00:00:00+00:00' },
  seven_day_opus: { utilization: 2.5, resets_at: '2026-07-27T00:00:00+00:00' },
};

describe('url matching', () => {
  it('matches usage + completion endpoints, extracts orgId', () => {
    const usage = 'https://claude.ai/api/organizations/abc-123/usage';
    const completion =
      'https://claude.ai/api/organizations/abc-123/chat_conversations/def-456/completion';
    assert.equal(isUsageUrl(usage), true);
    assert.equal(isUsageUrl(usage + '?tz=UTC'), true);
    assert.equal(isCompletionUrl(completion), true);
    assert.equal(
      isCompletionUrl(
        'https://claude.ai/api/organizations/abc/chat_conversations/def/retry_completion',
      ),
      true,
    );
    assert.equal(orgIdFromUsageUrl(usage), 'abc-123');
    assert.equal(isUsageUrl('https://claude.ai/api/organizations/abc/chat_conversations'), false);
    assert.equal(isCompletionUrl('https://evil.example/api/organizations/a/usage'), false);
  });
});

describe('parseUsageResponse', () => {
  it('normalizes the known 0–100 shape', () => {
    const snap = parseUsageResponse(USAGE_FIXTURE, 'fetch', new Date('2026-07-21T14:00:00Z'));
    assert.equal(snap.sessionPct, 0.23);
    assert.equal(snap.sessionResetAt, '2026-07-21T18:05:00.000Z');
    assert.equal(snap.weekly.length, 2);
    assert.deepEqual(snap.weekly[0], {
      limitType: 'all_models',
      pct: 0.08,
      resetAt: '2026-07-27T00:00:00.000Z',
    });
    assert.deepEqual(snap.weekly[1], {
      limitType: 'opus',
      pct: 0.025,
      resetAt: '2026-07-27T00:00:00.000Z',
    });
    assert.equal(snap.source, 'fetch');
  });

  it('accepts 0–1 float utilization', () => {
    const snap = parseUsageResponse({
      five_hour: { utilization: 0.31, resets_at: '2026-07-21T18:05:00Z' },
    });
    assert.equal(snap.sessionPct, 0.31);
  });

  it('keeps unknown seven_day_* buckets without hardcoding', () => {
    const snap = parseUsageResponse({
      ...USAGE_FIXTURE,
      seven_day_haiku_turbo: { utilization: 50, resets_at: '2026-07-27T00:00:00Z' },
    });
    assert.ok(snap.weekly.some((w) => w.limitType === 'haiku_turbo' && w.pct === 0.5));
  });

  it('fails soft (null) on unrecognized shapes', () => {
    assert.equal(parseUsageResponse(null), null);
    assert.equal(parseUsageResponse([]), null);
    assert.equal(parseUsageResponse({ totally: 'different' }), null);
    assert.equal(parseUsageResponse({ five_hour: { utilization: 'NaN%' } }), null);
  });

  it('normalizePct clamps and rejects garbage', () => {
    assert.equal(normalizePct(150), 1);
    assert.equal(normalizePct(0.5), 0.5);
    assert.equal(normalizePct(50), 0.5);
    assert.equal(normalizePct(-2), 0);
    assert.equal(normalizePct('12'), null);
    assert.equal(normalizePct(NaN), null);
  });
});

describe('SSE handling', () => {
  it('extracts message_limit events from a raw SSE chunk', () => {
    const raw = [
      'event: completion',
      'data: {"type":"completion","completion":"ignored"}',
      '',
      'event: message_limit',
      'data: {"type":"message_limit","message_limit":{"utilization":31.5,"resets_at":"2026-07-21T18:05:00Z"}}',
      '',
      'data: [DONE]',
      'data: {broken json',
    ].join('\n');
    const events = [...sseDataPayloads(raw)];
    assert.equal(events.length, 2);
    const partial = parseSseEvent(events[1], new Date('2026-07-21T14:00:00Z'));
    assert.equal(partial.sessionPct, 0.315);
    assert.equal(partial.sessionResetAt, '2026-07-21T18:05:00.000Z');
    assert.equal(partial.source, 'sse');
  });

  it('ignores non-message_limit events and empty payloads', () => {
    assert.equal(parseSseEvent({ type: 'completion' }), null);
    assert.equal(parseSseEvent({ type: 'message_limit', message_limit: {} }), null);
    assert.equal(parseSseEvent(null), null);
  });

  it('merges partial SSE snapshots over the last full one', () => {
    const full = parseUsageResponse(USAGE_FIXTURE, 'fetch', new Date('2026-07-21T14:00:00Z'));
    const merged = mergeSnapshot(full, {
      sessionPct: 0.29,
      capturedAt: '2026-07-21T14:01:00.000Z',
      source: 'sse',
    });
    assert.equal(merged.sessionPct, 0.29);
    assert.equal(merged.sessionResetAt, full.sessionResetAt);
    assert.equal(merged.weekly.length, 2);
    assert.equal(merged.source, 'sse');
  });
});
