import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client.js';
import { userSettings } from '../db/schema.js';
import { settingsPatchSchema } from '../lib/validation.js';
import type { AuthedRequest } from '../middleware/auth.js';

type SettingsRow = typeof userSettings.$inferSelect;

function toJson(row: SettingsRow) {
  return {
    warnSession: Number(row.warnSession),
    blockSession: Number(row.blockSession),
    warnWeekly: Number(row.warnWeekly),
    blockWeekly: Number(row.blockWeekly),
    hardBlockEnabled: row.hardBlockEnabled,
    retentionDays: row.retentionDays,
  };
}

export function makeSettingsRouter(db: Db) {
  const router = Router();

  router.get('/settings', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      let rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, user.id))
        .limit(1);
      if (!rows[0]) {
        rows = await db
          .insert(userSettings)
          .values({ userId: user.id })
          .onConflictDoNothing()
          .returning();
      }
      res.json(toJson(rows[0]!));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const body = settingsPatchSchema.parse(req.body);
      const set: Partial<typeof userSettings.$inferInsert> = {};
      if (body.warnSession != null) set.warnSession = String(body.warnSession);
      if (body.blockSession != null) set.blockSession = String(body.blockSession);
      if (body.warnWeekly != null) set.warnWeekly = String(body.warnWeekly);
      if (body.blockWeekly != null) set.blockWeekly = String(body.blockWeekly);
      if (body.hardBlockEnabled != null) set.hardBlockEnabled = body.hardBlockEnabled;
      if (body.retentionDays != null) set.retentionDays = body.retentionDays;

      if (Object.keys(set).length === 0) {
        let current = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, user.id))
          .limit(1);
        if (!current[0]) {
          current = await db
            .insert(userSettings)
            .values({ userId: user.id })
            .onConflictDoNothing()
            .returning();
        }
        res.json(toJson(current[0]!));
        return;
      }

      const rows = await db
        .insert(userSettings)
        .values({ userId: user.id, ...set })
        .onConflictDoUpdate({ target: userSettings.userId, set })
        .returning();
      res.json(toJson(rows[0]!));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
