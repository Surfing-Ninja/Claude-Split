import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await makeTestApp({ corsOrigins: ['https://dashboard.example.com'] });
});
afterAll(async () => {
  await ctx.close();
});

describe('CORS', () => {
  it('allows ANY browser-extension origin without configuration', async () => {
    for (const origin of [
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'moz-extension://12345678-90ab-cdef-1234-567890abcdef',
    ]) {
      const res = await request(ctx.app).get('/healthz').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('answers preflight for extension origins', async () => {
    const res = await request(ctx.app)
      .options('/api/v1/auth/login')
      .set('Origin', 'chrome-extension://cccccccccccccccccccccccccccccccc')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('allows explicitly configured web origins, refuses others', async () => {
    const allowed = await request(ctx.app)
      .get('/healthz')
      .set('Origin', 'https://dashboard.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://dashboard.example.com');

    const refused = await request(ctx.app)
      .get('/healthz')
      .set('Origin', 'https://evil.example.com');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });
});
