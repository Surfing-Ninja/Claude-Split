import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await makeTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('auth lifecycle', () => {
  it('register → me → logout → me 401', async () => {
    const { token } = await registerUser(ctx.app, 'alice@example.com');
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const me = await request(ctx.app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('alice@example.com');

    const out = await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    const meAfter = await request(ctx.app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meAfter.status).toBe(401);
  });

  it('rejects duplicate email with 409', async () => {
    await registerUser(ctx.app, 'dup@example.com');
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'another password 1' });
    expect(res.status).toBe(409);
  });

  it('login works with correct password, 401 with wrong', async () => {
    const { email, password } = await registerUser(ctx.app, 'bob@example.com');
    const ok = await request(ctx.app).post('/api/v1/auth/login').send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong password!' });
    expect(bad.status).toBe(401);
  });

  it('locks out after repeated failed logins (backoff)', async () => {
    const { email } = await registerUser(ctx.app, 'locked@example.com');
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'nope nope nope' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('rejects malformed bodies and unknown keys', async () => {
    const badEmail = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'long enough pw' });
    expect(badEmail.status).toBe(400);

    const shortPw = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'short' });
    expect(shortPw.status).toBe(400);

    // .strict() — unknown keys (e.g. someone trying to send a Claude cookie)
    const extraKey = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'y@example.com', password: 'long enough pw', claudeCookie: 'sk-...' });
    expect(extraKey.status).toBe(400);
  });

  it('DELETE /me wipes the account', async () => {
    const { token, email, password } = await registerUser(ctx.app, 'gone@example.com');
    const del = await request(ctx.app)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(401);
  });
});
