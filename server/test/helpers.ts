import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type express from 'express';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp, type AppOptions } from '../src/app.js';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

export type TestContext = {
  app: express.Express;
  db: Db;
  close: () => Promise<void>;
};

export async function makeTestApp(overrides: Partial<AppOptions> = {}): Promise<TestContext> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  const app = createApp({
    db: db as unknown as Db,
    corsOrigins: ['chrome-extension://test'],
    tokenTtlDays: 30,
    // generous defaults so unrelated tests never trip limits
    authRateLimit: { windowMs: 60_000, limit: 1000 },
    apiRateLimit: { windowMs: 60_000, limit: 10_000 },
    ...overrides,
  });
  return {
    app,
    db: db as unknown as Db,
    close: () => client.close(),
  };
}

export async function registerUser(
  app: express.Express,
  email = `user-${Math.random().toString(36).slice(2)}@example.com`,
  password = 'correct horse battery',
): Promise<{ token: string; email: string; password: string }> {
  const res = await request(app).post('/api/v1/auth/register').send({ email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { token: res.body.token, email, password };
}

export async function registerDevice(
  app: express.Express,
  token: string,
  deviceUuid = crypto.randomUUID(),
  name = 'Test Chrome',
  kind: 'browser' | 'claude-code' = 'browser',
): Promise<{ id: string; deviceUuid: string }> {
  const res = await request(app)
    .post('/api/v1/devices/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ deviceUuid, name, kind });
  if (res.status !== 201) throw new Error(`device register failed: ${res.status} ${res.text}`);
  return { id: res.body.id, deviceUuid };
}

export function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}
