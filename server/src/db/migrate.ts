import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createPgDb } from './client.js';
import { loadEnv } from '../lib/env.js';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

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
