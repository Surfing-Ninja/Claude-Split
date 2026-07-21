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
let tokenA: string;
let tokenB: string;
let deviceA: { id: string; deviceUuid: string };

beforeAll(async () => {
  ctx = await makeTestApp();
  tokenA = (await registerUser(ctx.app, 'a@example.com')).token;
  tokenB = (await registerUser(ctx.app, 'b@example.com')).token;
  deviceA = await registerDevice(ctx.app, tokenA, undefined, "A's laptop");
  await request(ctx.app)
    .post('/api/v1/usage/log')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      deviceUuid: deviceA.deviceUuid,
      occurredAt: new Date().toISOString(),
      sessionDelta: 0.05,
      sessionPctAfter: 0.05,
      sessionResetAt: futureIso(3 * 60 * 60 * 1000),
    });
});
afterAll(async () => {
  await ctx.close();
});

describe('cross-user isolation (must be impossible by construction)', () => {
  it("B's device list does not contain A's devices", async () => {
    const res = await request(ctx.app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("B cannot rename A's device (404, not 403 — existence is not leaked)", async () => {
    const res = await request(ctx.app)
      .patch(`/api/v1/devices/${deviceA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'hijacked' });
    expect(res.status).toBe(404);

    const check = await request(ctx.app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(check.body[0].name).toBe("A's laptop");
  });

  it("B cannot log usage against A's deviceUuid", async () => {
    const res = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        deviceUuid: deviceA.deviceUuid,
        occurredAt: new Date().toISOString(),
        sessionDelta: 0.5,
      });
    expect(res.status).toBe(404);
  });

  it("B's summary contains none of A's usage", async () => {
    const res = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.latest).toBeNull();
    expect(res.body.devices).toEqual([]);

    const resA = await request(ctx.app)
      .get('/api/v1/usage/summary')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.body.session.pct).toBeCloseTo(0.05, 5);
  });

  it('no endpoint accepts a user id from the client', async () => {
    // strict schemas reject attempts to smuggle a userId
    const res = await request(ctx.app)
      .post('/api/v1/usage/log')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        deviceUuid: deviceA.deviceUuid,
        occurredAt: new Date().toISOString(),
        sessionDelta: 0.01,
        userId: 'someone-else',
      });
    expect(res.status).toBe(400);
  });
});
