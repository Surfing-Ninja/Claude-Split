import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { Db } from '../db/client.js';
import { sessions, users, userSettings } from '../db/schema.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { loginSchema, registerSchema } from '../lib/validation.js';
import type { AuthedRequest } from '../middleware/auth.js';

// argon2id baseline per §7.3: 64 MiB memory, time cost 3, parallelism 1.
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Failed-login backoff (per email+IP, in-memory): after 3 consecutive
 * failures, lock for 2^(failures-3) minutes, capped at 15 minutes.
 * Complements the per-IP rate limit on /auth/*.
 */
class LoginBackoff {
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  lockedForMs(key: string, now = Date.now()): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= 3) {
      const minutes = Math.min(2 ** (entry.count - 3), 15);
      entry.lockedUntil = now + minutes * 60 * 1000;
    }
    this.failures.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}

async function createSession(db: Db, userId: string, ttlDays: number) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

export function makeAuthRouter(
  db: Db,
  ttlDays: number,
  requireAuth: import('express').RequestHandler,
) {
  const router = Router();
  const backoff = new LoginBackoff();

  router.post('/auth/register', async (req, res, next) => {
    try {
      const body = registerSchema.parse(req.body);
      const passwordHash = await argon2.hash(body.password, ARGON2_OPTS);
      const inserted = await db
        .insert(users)
        .values({ email: body.email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      const user = inserted[0];
      if (!user) {
        res.status(409).json({ error: 'email already registered' });
        return;
      }
      await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
      const session = await createSession(db, user.id, ttlDays);
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      const key = `${body.email}|${req.ip ?? ''}`;
      const lockedMs = backoff.lockedForMs(key);
      if (lockedMs > 0) {
        res
          .status(429)
          .set('Retry-After', String(Math.ceil(lockedMs / 1000)))
          .json({ error: 'too many failed attempts, try again later' });
        return;
      }
      const found = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      const user = found[0];
      // Always run a verify to keep timing consistent for unknown emails.
      const ok = user
        ? await argon2.verify(user.passwordHash, body.password)
        : (await argon2.hash(body.password, ARGON2_OPTS), false);
      if (!ok || !user) {
        backoff.recordFailure(key);
        res.status(401).json({ error: 'invalid email or password' });
        return;
      }
      backoff.recordSuccess(key);
      const session = await createSession(db, user.id, ttlDays);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', requireAuth, async (req, res, next) => {
    try {
      const { tokenHash } = req as AuthedRequest;
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const rows = await db
        .select({ id: users.id, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // GDPR-style wipe: users row cascades to sessions, devices, events, settings.
  router.delete('/me', requireAuth, async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      await db.delete(users).where(eq(users.id, user.id));
      res.json({ ok: true, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
