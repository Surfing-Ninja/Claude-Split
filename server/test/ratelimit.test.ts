import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await makeTestApp({ authRateLimit: { windowMs: 60_000, limit: 3 } });
});
afterAll(async () => {
  await ctx.close();
});

describe('auth brute-force rate limiting', () => {
  it('returns 429 once the per-IP auth limit is exhausted', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever pw 123' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
  });
});
