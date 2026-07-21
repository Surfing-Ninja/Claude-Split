import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Data minimization (§7.3): prune usage_events older than each user's
 * retention window (user_settings.retention_days, falling back to the
 * instance default for users without a settings row).
 */
export async function pruneOldEvents(db: Db, defaultRetentionDays: number): Promise<void> {
  await db.execute(sql`
    delete from usage_events ue
    using user_settings us
    where us.user_id = ue.user_id
      and ue.created_at < now() - make_interval(days => us.retention_days)
  `);
  await db.execute(sql`
    delete from usage_events ue
    where not exists (select 1 from user_settings us where us.user_id = ue.user_id)
      and ue.created_at < now() - make_interval(days => ${defaultRetentionDays}::int)
  `);
}

export function startRetentionJob(db: Db, defaultRetentionDays: number): NodeJS.Timeout {
  const run = () =>
    pruneOldEvents(db, defaultRetentionDays).catch((err) =>
      console.error('retention prune failed:', err),
    );
  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
