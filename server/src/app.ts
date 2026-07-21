import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import { hashToken } from './lib/tokens.js';
import { makeAuthMiddleware } from './middleware/auth.js';
import { makeAuthRouter } from './routes/auth.js';
import { makeDevicesRouter } from './routes/devices.js';
import { makeSettingsRouter } from './routes/settings.js';
import { makeUsageRouter } from './routes/usage.js';

export type AppOptions = {
  db: Db;
  corsOrigins: string[];
  tokenTtlDays: number;
  /** overridable for tests */
  authRateLimit?: { windowMs: number; limit: number };
  apiRateLimit?: { windowMs: number; limit: number };
  trustProxy?: boolean;
};

// Browser-extension origins are always allowed: every unpacked install gets a
// unique extension ID, and requiring server reconfiguration per install would
// make onboarding impossible. This is safe because the API carries no ambient
// credentials (no cookies) — every request must present a bearer token, so
// CORS here only governs who can *read* responses they already authorized.
// CORS_ORIGINS remains for optional extra web origins (or '*' to allow all).
const EXTENSION_ORIGIN_RE = /^(chrome-extension|moz-extension|safari-web-extension):\/\//;

function corsAllowlist(allowed: string[]) {
  const allowAll = allowed.includes('*');
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (allowAll || EXTENSION_ORIGIN_RE.test(origin) || allowed.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function createApp(opts: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(corsAllowlist(opts.corsOrigins));
  app.use(express.json({ limit: '64kb' }));

  const authLimiter = rateLimit({
    windowMs: opts.authRateLimit?.windowMs ?? 60 * 1000,
    limit: opts.authRateLimit?.limit ?? 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
  });

  const apiLimiter = rateLimit({
    windowMs: opts.apiRateLimit?.windowMs ?? 60 * 1000,
    limit: opts.apiRateLimit?.limit ?? 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
    // Per-token where possible so shared NATs don't starve each other.
    keyGenerator: (req) => {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) return hashToken(header.slice(7).trim());
      return req.ip ?? 'unknown';
    },
  });

  const requireAuth = makeAuthMiddleware(opts.db, opts.tokenTtlDays);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use('/auth', authLimiter);
  api.use(apiLimiter);
  api.use(makeAuthRouter(opts.db, opts.tokenTtlDays, requireAuth));
  api.use(requireAuth, makeDevicesRouter(opts.db));
  api.use(requireAuth, makeUsageRouter(opts.db));
  api.use(requireAuth, makeSettingsRouter(opts.db));
  app.use('/api/v1', api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid request', details: err.issues });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
    console.error('unhandled error:', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
