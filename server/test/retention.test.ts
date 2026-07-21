import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageEvents } from '../src/db/schema.js';
import { pruneOldEvents } from '../src/lib/retention.js';
import {
  futureIso,
  makeTestApp,
  registerDevice,
  registerUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let token: string;
let device: { id: string; deviceUuid: string };

beforeAll(async () => {
  ctx = await makeTestApp();
  token = (await registerUser(ctx.app)).token;
  device = await registerDevice(ctx.app, token);
});
afterAll(async () => {
  await ctx.close();
});

describe('retention pruning', () => {
  it('removes events older than the user retention window, keeps fresh ones', async () => {
    // fresh event via API
    await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceUuid: device.deviceUuid,
        occurredAt: new Date().toISOString(),
        sessionDelta: 0.01,
        sessionPctAfter: 0.01,
        sessionResetAt: futureIso(60 * 60 * 1000),
      });

    // stale event: back-date created_at past the 90-day default
    await ctx.db.execute(sql`
      update usage_events set created_at = now() - interval '120 days'
      where id = (select min(id) from usage_events)
    `);
    // and add one more fresh row so we can tell them apart
    await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceUuid: device.deviceUuid,
        occurredAt: new Date().toISOString(),
        sessionDelta: 0.02,
        sessionPctAfter: 0.03,
        sessionResetAt: futureIso(60 * 60 * 1000),
      });

    await pruneOldEvents(ctx.db, 90);

    const remaining = await ctx.db.select().from(usageEvents);
    expect(remaining.length).toBe(1);
    expect(Number(remaining[0]!.sessionDelta)).toBeCloseTo(0.02, 5);
  });

  it('respects a shorter per-user retention_days', async () => {
    await request(ctx.app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ retentionDays: 7 });

    await ctx.db.execute(sql`update usage_events set created_at = now() - interval '10 days'`);
    await pruneOldEvents(ctx.db, 90);

    const remaining = await ctx.db.select().from(usageEvents);
    expect(remaining.length).toBe(0);
  });
});

describe('token hygiene', () => {
  it('expired sessions are rejected', async () => {
    const { token: t } = await registerUser(ctx.app, 'expiry@example.com');
    await ctx.db.execute(sql`update sessions set expires_at = now() - interval '1 minute'`);
    const res = await request(ctx.app).get('/api/v1/me').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
  });
});
