import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client.js';
import { devices } from '../db/schema.js';
import { devicePatchSchema, deviceRegisterSchema } from '../lib/validation.js';
import type { AuthedRequest } from '../middleware/auth.js';

const deviceColumns = {
  id: devices.id,
  deviceUuid: devices.deviceUuid,
  name: devices.name,
  kind: devices.kind,
  createdAt: devices.createdAt,
  lastSeenAt: devices.lastSeenAt,
};

export function makeDevicesRouter(db: Db) {
  const router = Router();

  // Idempotent on (userId, deviceUuid). Re-registering refreshes last_seen_at
  // but never clobbers a name the user set via PATCH.
  router.post('/devices/register', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const body = deviceRegisterSchema.parse(req.body);
      const rows = await db
        .insert(devices)
        .values({
          userId: user.id,
          deviceUuid: body.deviceUuid,
          name: body.name,
          kind: body.kind,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [devices.userId, devices.deviceUuid],
          set: { lastSeenAt: new Date() },
        })
        .returning(deviceColumns);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  router.get('/devices', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const rows = await db
        .select(deviceColumns)
        .from(devices)
        .where(eq(devices.userId, user.id))
        .orderBy(sql`${devices.createdAt} asc`);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/devices/:id', async (req, res, next) => {
    try {
      const { user } = req as unknown as AuthedRequest;
      const body = devicePatchSchema.parse(req.body);
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.status(404).json({ error: 'device not found' });
        return;
      }
      const rows = await db
        .update(devices)
        .set({ name: body.name })
        .where(and(eq(devices.id, id), eq(devices.userId, user.id)))
        .returning(deviceColumns);
      if (!rows[0]) {
        res.status(404).json({ error: 'device not found' });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
