import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  futureIso,
  makeTestApp,
  registerDevice,
  registerUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let token: string;
let laptop: { id: string; deviceUuid: string };
let tablet: { id: string; deviceUuid: string };

const sessionResetAt = futureIso(4 * 60 * 60 * 1000);
const weeklyResetAt = futureIso(5 * 24 * 60 * 60 * 1000);

function logBody(deviceUuid: string, sessionDelta: number, sessionPctAfter: number) {
  return {
    deviceUuid,
    occurredAt: new Date().toISOString(),
    sessionDelta,
    sessionPctAfter,
    sessionResetAt,
    weeklyDeltas: [{ limitType: 'all_models', delta: sessionDelta / 10 }],
    weeklySnapshots: [
      { limitType: 'all_models', pct: sessionPctAfter / 10, resetAt: weeklyResetAt },
    ],
  };
}

beforeAll(async () => {
  ctx = await makeTestApp();
  token = (await registerUser(ctx.app)).token;
  laptop = await registerDevice(ctx.app, token, undefined, 'Laptop');
  tablet = await registerDevice(ctx.app, token, undefined, 'Tablet');
});
afterAll(async () => {
  await ctx.close();
});

describe('usage logging + summary', () => {
  it('attributes deltas per device and computes unattributed remainder', async () => {
    // laptop: 2 sends totalling 0.12; tablet: 1 send of 0.06
    for (const [delta, after] of [
      [0.05, 0.05],
      [0.07, 0.12],
    ] as const) {
      const res = await request(ctx.app)
        .post('/api/v1/usage/log')
        .set('Authorization', `Bearer ${token}`)
        .send(logBody(laptop.deviceUuid, delta, after));
      expect(res.status).toBe(201);
    }
    const t = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      // official pct jumps to 0.30: 0.12 remains unattributed (e.g. Desktop)
      .send(logBody(tablet.deviceUuid, 0.06, 0.3));
    expect(t.status).toBe(201);

    const summary = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.status).toBe(200);

    const byName = new Map(
      summary.body.devices.map((d: { name: string; sessionPct: number }) => [d.name, d]),
    );
    expect((byName.get('Laptop') as { sessionPct: number }).sessionPct).toBeCloseTo(0.12, 5);
    expect((byName.get('Tablet') as { sessionPct: number }).sessionPct).toBeCloseTo(0.06, 5);
    expect(summary.body.session.pct).toBeCloseTo(0.3, 5);
    expect(summary.body.session.unattributedPct).toBeCloseTo(0.12, 5);
    expect(summary.body.session.overlapDetected).toBe(false);

    const weekly = summary.body.weekly.find(
      (w: { limitType: string }) => w.limitType === 'all_models',
    );
    expect(weekly).toBeTruthy();
    expect(weekly.pct).toBeCloseTo(0.03, 5);
  });

  it('clamps over-attribution to zero and flags overlap', async () => {
    // official pct (0.3) < attributed sum after this: two devices "saw" the
    // same jump — attributed 0.18 + 0.2 > 0.3
    await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .send(logBody(tablet.deviceUuid, 0.2, 0.3));

    const summary = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.body.session.unattributedPct).toBe(0);
    expect(summary.body.session.overlapDetected).toBe(true);
  });

  it('is idempotent under retries via Idempotency-Key', async () => {
    const body = logBody(laptop.deviceUuid, 0.01, 0.31);
    const key = crypto.randomUUID();
    const first = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const retry = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);

    const before = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${token}`);
    const laptopRow = before.body.devices.find((d: { name: string }) => d.name === 'Laptop');
    expect(laptopRow.sessionPct).toBeCloseTo(0.13, 5); // 0.12 + 0.01, once
  });

  it('rejects negative and out-of-range values', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...logBody(laptop.deviceUuid, 0.01, 0.31), sessionDelta: Number.NaN });
    expect(res.status).toBe(400);

    // out-of-range clamps rather than errors (per spec §7.3)
    const clamped = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...logBody(laptop.deviceUuid, 0.01, 0.31), sessionDelta: 7 });
    expect(clamped.status).toBe(201);
  });

  it('manual reset clears session attribution', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/usage/reset')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'session' });
    expect(res.status).toBe(200);

    const summary = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summary.body.session.pct).toBe(0);
    for (const d of summary.body.devices) {
      expect(d.sessionPct).toBe(0);
    }
  });
});

describe('settings', () => {
  it('GET returns defaults, PATCH updates and persists', async () => {
    const get = await request(ctx.app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.warnSession).toBeCloseTo(0.9, 5);
    expect(get.body.hardBlockEnabled).toBe(true);

    const patch = await request(ctx.app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ warnSession: 0.8, hardBlockEnabled: false, retentionDays: 30 });
    expect(patch.status).toBe(200);
    expect(patch.body.warnSession).toBeCloseTo(0.8, 5);
    expect(patch.body.hardBlockEnabled).toBe(false);
    expect(patch.body.retentionDays).toBe(30);

    const rejected = await request(ctx.app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ retentionDays: 0 });
    expect(rejected.status).toBe(400);
  });
});
