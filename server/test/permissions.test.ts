import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerDevice, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let ownerToken: string;
let memberToken: string;
let ownerDevice: { id: string; deviceUuid: string };
let memberDevice: { id: string; deviceUuid: string };

beforeAll(async () => {
  ctx = await makeTestApp();
  const { token, email, password } = await registerUser(ctx.app, 'family@example.com');
  ownerToken = token;
  // first registered device → owner, and the registering token binds to it
  ownerDevice = await registerDevice(ctx.app, ownerToken, undefined, "Dad's laptop");

  // a second sign-in from another machine
  const login = await request(ctx.app).post('/api/v1/auth/login').send({ email, password });
  memberToken = login.body.token;
  memberDevice = await registerDevice(ctx.app, memberToken, undefined, 'Kid laptop');
});
afterAll(async () => {
  await ctx.close();
});

describe('owner-device permissions', () => {
  it('assigns owner to the first device, member to later ones', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${ownerToken}`);
    const byId = new Map(res.body.map((d: { id: string; role: string }) => [d.id, d.role]));
    expect(byId.get(ownerDevice.id)).toBe('owner');
    expect(byId.get(memberDevice.id)).toBe('member');
  });

  it('member devices cannot change settings; the owner can', async () => {
    const denied = await request(ctx.app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ blockSession: 0.5 });
    expect(denied.status).toBe(403);

    const allowed = await request(ctx.app)
      .patch('/api/v1/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ blockSession: 0.95 });
    expect(allowed.status).toBe(200);
    expect(allowed.body.blockSession).toBeCloseTo(0.95, 5);

    // member can still READ the owner's settings
    const read = await request(ctx.app)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(read.status).toBe(200);
    expect(read.body.blockSession).toBeCloseTo(0.95, 5);
  });

  it('member devices cannot reset usage counters', async () => {
    const denied = await request(ctx.app)
      .post('/api/v1/usage/reset')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ scope: 'all' });
    expect(denied.status).toBe(403);

    const allowed = await request(ctx.app)
      .post('/api/v1/usage/reset')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ scope: 'all' });
    expect(allowed.status).toBe(200);
  });

  it('a member may rename itself but not other devices', async () => {
    const self = await request(ctx.app)
      .patch(`/api/v1/devices/${memberDevice.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Kid laptop (renamed)' });
    expect(self.status).toBe(200);

    const other = await request(ctx.app)
      .patch(`/api/v1/devices/${ownerDevice.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'hijacked' });
    expect(other.status).toBe(403);

    const ownerRenamesMember = await request(ctx.app)
      .patch(`/api/v1/devices/${memberDevice.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Kid laptop (set by owner)' });
    expect(ownerRenamesMember.status).toBe(200);
  });

  it('member devices cannot delete the account; the owner can', async () => {
    const denied = await request(ctx.app)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(denied.status).toBe(403);

    const allowed = await request(ctx.app)
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(allowed.status).toBe(200);
  });
});
