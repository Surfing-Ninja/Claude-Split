import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

// A driver-agnostic handle: production uses node-postgres (Neon-compatible),
// tests use PGlite. Both satisfy this type.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createPgDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
