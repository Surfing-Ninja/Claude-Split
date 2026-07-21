import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// HARD RULE (§7.3): no column anywhere in this schema may carry Claude
// cookies, tokens, or message content. Reviewers: reject any PR that adds one.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('sessions_token_hash_idx').on(t.tokenHash)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceUuid: text('device_uuid').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('devices_user_device_uuid_uq').on(t.userId, t.deviceUuid),
    check('devices_kind_check', sql`${t.kind} in ('browser', 'claude-code')`),
  ],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    sessionDelta: numeric('session_delta', { precision: 8, scale: 6 }).notNull(),
    sessionPctAfter: numeric('session_pct_after', { precision: 8, scale: 6 }),
    sessionResetAt: timestamp('session_reset_at', { withTimezone: true }),
    // [{limitType, delta, pct, resetAt}] — kept as JSONB because Max plans
    // expose a variable set of weekly buckets and Anthropic may add types.
    weekly: jsonb('weekly'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usage_events_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    index('usage_events_user_occurred_idx').on(t.userId, t.occurredAt.desc()),
    index('usage_events_device_occurred_idx').on(t.deviceId, t.occurredAt.desc()),
    check('usage_events_session_delta_check', sql`${t.sessionDelta} >= 0`),
  ],
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  warnSession: numeric('warn_session', { precision: 4, scale: 3 }).notNull().default('0.90'),
  blockSession: numeric('block_session', { precision: 4, scale: 3 }).notNull().default('0.98'),
  warnWeekly: numeric('warn_weekly', { precision: 4, scale: 3 }).notNull().default('0.90'),
  blockWeekly: numeric('block_weekly', { precision: 4, scale: 3 }).notNull().default('0.98'),
  hardBlockEnabled: boolean('hard_block_enabled').notNull().default(true),
  retentionDays: integer('retention_days').notNull().default(90),
});

export type WeeklyEntry = {
  limitType: string;
  delta: number;
  pct: number | null;
  resetAt: string | null;
};
