import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { hashToken } from '../lib/tokens.js';

export type AuthedRequest = Request & {
  user: { id: string; email: string };
  sessionId: string;
  tokenHash: string;
};

const SLIDING_UPDATE_THROTTLE_MS = 5 * 60 * 1000;

export function makeAuthMiddleware(db: Db, tokenTtlDays: number) {
  return async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'missing bearer token' });
        return;
      }
      const token = header.slice('Bearer '.length).trim();
      if (!token) {
        res.status(401).json({ error: 'missing bearer token' });
        return;
      }
      const tokenHash = hashToken(token);
      const rows = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      const now = new Date();
      if (!row || row.session.expiresAt.getTime() <= now.getTime()) {
        res.status(401).json({ error: 'invalid or expired token' });
        return;
      }

      // Sliding expiry (§7.3), throttled so not every request writes.
      const lastUsed = row.session.lastUsedAt?.getTime() ?? 0;
      if (now.getTime() - lastUsed > SLIDING_UPDATE_THROTTLE_MS) {
        await db
          .update(sessions)
          .set({
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + tokenTtlDays * 24 * 60 * 60 * 1000),
          })
          .where(eq(sessions.id, row.session.id));
      }

      const authed = req as AuthedRequest;
      authed.user = { id: row.user.id, email: row.user.email };
      authed.sessionId = row.session.id;
      authed.tokenHash = tokenHash;
      next();
    } catch (err) {
      next(err);
    }
  };
}
