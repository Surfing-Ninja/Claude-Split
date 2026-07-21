import { and, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client.js';
import { devices, sessions } from '../db/schema.js';
import { isOwnerRequest, OWNER_ONLY_ERROR } from '../lib/permissions.js';
import { devicePatchSchema, deviceRegisterSchema } from '../lib/validation.js';
import type { AuthedRequest } from '../middleware/auth.js';

const deviceColumns = {
  id: devices.id,
  deviceUuid: devices.deviceUuid,
  name: devices.name,
  kind: devices.kind,
  role: devices.role,
  createdAt: devices.createdAt,
  lastSeenAt: devices.lastSeenAt,
};

export function makeDevicesRouter(db: Db) {
  const router = Router();

  // Idempotent on (userId, deviceUuid). Re-registering refreshes last_seen_at
  // but never clobbers a name set via PATCH or an existing role. The first
  // device an account registers becomes 'owner' (§owner-device rule).
  router.post('/devices/register', async (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      const { user } = authed;
      const body = deviceRegisterSchema.parse(req.body);

      const existing = await db
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.userId, user.id))
        .limit(1);
      const role = existing.length === 0 ? 'owner' : 'member';

      const rows = await db
        .insert(devices)
        .values({
          userId: user.id,
          deviceUuid: body.deviceUuid,
          name: body.name,
          kind: body.kind,
          role,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [devices.userId, devices.deviceUuid],
          set: { lastSeenAt: new Date() },
        })
        .returning(deviceColumns);
      const device = rows[0]!;

      // Bind this token to its device on first registration only — a token
      // keeps the identity of the device it originally signed in from.
      await db
        .update(sessions)
        .set({ deviceId: device.id })
        .where(and(eq(sessions.id, authed.sessionId), isNull(sessions.deviceId)));

      res.status(201).json(device);
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

  // Rename: a device may rename itself; only the owner device may rename others.
  router.patch('/devices/:id', async (req, res, next) => {
    try {
      const authed = req as unknown as AuthedRequest;
      const { user } = authed;
      const body = devicePatchSchema.parse(req.body);
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        res.status(404).json({ error: 'device not found' });
        return;
      }
      if (id !== authed.sessionDeviceId) {
        const owner = await isOwnerRequest(db, user.id, authed.sessionDeviceId);
        if (!owner) {
          res.status(403).json({ error: OWNER_ONLY_ERROR });
          return;
        }
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
