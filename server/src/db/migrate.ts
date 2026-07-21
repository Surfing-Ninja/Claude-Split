import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPgDb } from './client.js';
import { loadEnv } from '../lib/env.js';

// The build copies src/db/migrations into dist/db/migrations; the src
// fallback covers running via tsx or a build that skipped the copy.
const migrationsFolder = ((): string => {
  const found = [
    fileURLToPath(new URL('./migrations', import.meta.url)),
    fileURLToPath(new URL('../../src/db/migrations', import.meta.url)),
  ].find(existsSync);
  if (!found) {
    throw new Error('migrations folder not found — run the build or check the checkout');
  }
  return found;
})();

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createPgDb(databaseUrl);
  try {
    // drizzle's migrator needs the concrete driver type, not our Db union
    await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const env = loadEnv();
  runMigrations(env.databaseUrl)
    .then(() => {
      console.log('migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migration failed:', err);
      process.exit(1);
    });
}
