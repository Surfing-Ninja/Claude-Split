import { createApp } from './app.js';
import { createPgDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { loadEnv } from './lib/env.js';
import { startRetentionJob } from './lib/retention.js';

async function main(): Promise<void> {
  const env = loadEnv();
  await runMigrations(env.databaseUrl);
  const { db } = createPgDb(env.databaseUrl);

  const app = createApp({
    db,
    corsOrigins: env.corsOrigins,
    tokenTtlDays: env.tokenTtlDays,
    trustProxy: true,
  });

  startRetentionJob(db, env.retentionDays);

  app.listen(env.port, () => {
    console.log(`claude-split server listening on :${env.port}`);
  });
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
