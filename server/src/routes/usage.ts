import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client.js';
import { devices, usageEvents, type WeeklyEntry } from '../db/schema.js';
import { isOwnerRequest, OWNER_ONLY_ERROR } from '../lib/permissions.js';
import { usageLogSchema, usageResetSchema } from '../lib/validation.js';
import type { AuthedRequest } from '../middleware/auth.js';

/** Reset timestamps from Claude are stable within a window; allow 60s jitter. */
const RESET_MATCH_TOLERANCE_MS = 60 * 1000;
/** Summary only ever needs the current session + current weekly windows. */
const SUMMARY_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;
/** Raw remainder below this is flagged as cross-device overlap, not noise. */
const OVERLAP_EPSILON = 0.001;

function sameReset(a: Date | string | null, b: Date | string | null): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < RESET_MATCH_TOLERANCE_MS;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function makeUsageRouter(db: Db) {
  const router = Router();

  router.post('/usage/log', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const body = usageLogSchema.parse(req.body);

      const deviceRows = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, user.id), eq(devices.deviceUuid, body.deviceUuid)))
        .limit(1);
      const device = deviceRows[0];
      if (!device) {
        res.status(404).json({ error: 'device not registered' });
        return;
      }

      const idempotencyHeader = req.headers['idempotency-key'];
      const idempotencyKey =
        typeof idempotencyHeader === 'string' && idempotencyHeader.trim()
          ? idempotencyHeader.trim().slice(0, 128)
          : null;

      const weekly: WeeklyEntry[] = body.weeklyDeltas.map((d) => {
        const snap = body.weeklySnapshots.find((s) => s.limitType === d.limitType);
        return {
          limitType: d.limitType,
          delta: d.delta,
          pct: snap?.pct ?? null,
          resetAt: snap?.resetAt ?? null,
        };
      });
      // Snapshot-only buckets (no delta this send) still update "latest known".
      for (const snap of body.weeklySnapshots) {
        if (!weekly.some((w) => w.limitType === snap.limitType)) {
          weekly.push({
            limitType: snap.limitType,
            delta: 0,
            pct: snap.pct,
            resetAt: snap.resetAt,
          });
        }
      }

      const inserted = await db
        .insert(usageEvents)
        .values({
          userId: user.id,
          deviceId: device.id,
          occurredAt: new Date(body.occurredAt),
          sessionDelta: String(body.sessionDelta),
          sessionPctAfter: body.sessionPctAfter != null ? String(body.sessionPctAfter) : null,
          sessionResetAt: body.sessionResetAt ? new Date(body.sessionResetAt) : null,
          weekly,
          idempotencyKey,
        })
        .onConflictDoNothing(
          idempotencyKey ? { target: [usageEvents.userId, usageEvents.idempotencyKey] } : undefined,
        )
        .returning({ id: usageEvents.id });

      await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));

      if (!inserted[0]) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      res.status(201).json({ ok: true, id: inserted[0].id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/usage/summary', async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const now = Date.now();
      const since = new Date(now - SUMMARY_LOOKBACK_MS);

      const [deviceRows, events] = await Promise.all([
        db
          .select({
            id: devices.id,
            deviceUuid: devices.deviceUuid,
            name: devices.name,
            kind: devices.kind,
            role: devices.role,
            lastSeenAt: devices.lastSeenAt,
          })
          .from(devices)
          .where(eq(devices.userId, user.id)),
        db
          .select()
          .from(usageEvents)
          .where(and(eq(usageEvents.userId, user.id), gte(usageEvents.occurredAt, since)))
          .orderBy(asc(usageEvents.occurredAt)),
      ]);

      const latest = events[events.length - 1];
      const latestWeekly = (latest?.weekly ?? []) as WeeklyEntry[];

      // --- Session window: events sharing the latest (still future) resetAt ---
      const sessionResetAt = latest?.sessionResetAt ?? null;
      const sessionActive = sessionResetAt != null && sessionResetAt.getTime() > now;
      const sessionByDevice = new Map<string, number>();
      if (sessionActive) {
        for (const ev of events) {
          if (!sameReset(ev.sessionResetAt, sessionResetAt)) continue;
          const prev = sessionByDevice.get(ev.deviceId) ?? 0;
          sessionByDevice.set(ev.deviceId, prev + Number(ev.sessionDelta));
        }
      }
      const sessionLatestPct =
        sessionActive && latest?.sessionPctAfter != null ? Number(latest.sessionPctAfter) : 0;
      const sessionAttributed = [...sessionByDevice.values()].reduce((a, b) => a + b, 0);
      const sessionRemainder = sessionLatestPct - sessionAttributed;

      // --- Weekly windows: one bucket per limitType in the latest snapshot ---
      const weeklySummaries = latestWeekly
        .filter((w) => w.resetAt && new Date(w.resetAt).getTime() > now)
        .map((w) => {
          const byDevice = new Map<string, number>();
          for (const ev of events) {
            for (const entry of (ev.weekly ?? []) as WeeklyEntry[]) {
              if (entry.limitType !== w.limitType) continue;
              if (!sameReset(entry.resetAt, w.resetAt)) continue;
              byDevice.set(ev.deviceId, (byDevice.get(ev.deviceId) ?? 0) + entry.delta);
            }
          }
          const latestPct = w.pct ?? 0;
          const attributed = [...byDevice.values()].reduce((a, b) => a + b, 0);
          const remainder = latestPct - attributed;
          return {
            limitType: w.limitType,
            resetAt: w.resetAt,
            pct: round6(latestPct),
            devices: deviceRows.map((d) => ({
              id: d.id,
              pct: round6(byDevice.get(d.id) ?? 0),
            })),
            unattributedPct: round6(Math.max(0, remainder)),
            overlapDetected: remainder < -OVERLAP_EPSILON,
          };
        });

      res.json({
        latest: latest
          ? {
              capturedAt: latest.occurredAt.toISOString(),
              sessionPct: latest.sessionPctAfter != null ? Number(latest.sessionPctAfter) : null,
              sessionResetAt: latest.sessionResetAt?.toISOString() ?? null,
              weekly: latestWeekly.map((w) => ({
                limitType: w.limitType,
                pct: w.pct,
                resetAt: w.resetAt,
              })),
            }
          : null,
        devices: deviceRows.map((d) => ({
          ...d,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          sessionPct: round6(sessionByDevice.get(d.id) ?? 0),
        })),
        session: {
          active: sessionActive,
          resetAt: sessionActive ? sessionResetAt.toISOString() : null,
          pct: round6(sessionLatestPct),
          unattributedPct: round6(Math.max(0, sessionRemainder)),
          overlapDetected: sessionRemainder < -OVERLAP_EPSILON,
        },
        weekly: weeklySummaries,
      });
    } catch (err) {
      next(err);
    }
  });

  // Manual counter reset (testing + recovery): drops attribution events only.
  // Destructive, so owner-device only.
  router.post('/usage/reset', async (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      const { user } = authed;
      const body = usageResetSchema.parse(req.body);
      if (!(await isOwnerRequest(db, user.id, authed.sessionDeviceId))) {
        res.status(403).json({ error: OWNER_ONLY_ERROR });
        return;
      }
      if (body.scope === 'all') {
        await db.delete(usageEvents).where(eq(usageEvents.userId, user.id));
      } else if (body.scope === 'weekly') {
        await db
          .delete(usageEvents)
          .where(
            and(
              eq(usageEvents.userId, user.id),
              gte(usageEvents.occurredAt, sql`now() - interval '7 days'`),
            ),
          );
      } else {
        // session: drop events attached to the most recent session window
        const latest = await db
          .select({ sessionResetAt: usageEvents.sessionResetAt })
          .from(usageEvents)
          .where(eq(usageEvents.userId, user.id))
          .orderBy(sql`${usageEvents.occurredAt} desc`)
          .limit(1);
        const resetAt = latest[0]?.sessionResetAt;
        if (resetAt) {
          await db
            .delete(usageEvents)
            .where(
              and(
                eq(usageEvents.userId, user.id),
                sql`abs(extract(epoch from (${usageEvents.sessionResetAt} - ${resetAt}))) < 60`,
              ),
            );
        }
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
