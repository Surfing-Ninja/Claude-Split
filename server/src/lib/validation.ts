import { z } from 'zod';

// All request bodies are parsed with these schemas. `.strict()` everywhere:
// unknown keys are rejected, which also enforces the hard rule that no client
// can smuggle Claude credentials or content into the API (§7.3).

/** Fractions are clamped into [0,1]; NaN/Infinity rejected. */
const pct = z
  .number()
  .finite()
  .transform((n) => Math.min(1, Math.max(0, n)));

const isoDate = z.string().datetime({ offset: true }).max(64);

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(200),
  })
  .strict();

export const loginSchema = registerSchema;

export const deviceRegisterSchema = z
  .object({
    deviceUuid: z.string().min(8).max(64),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['browser', 'claude-code']),
  })
  .strict();

export const devicePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

const weeklyDeltaSchema = z
  .object({
    limitType: z.string().min(1).max(64),
    delta: pct,
  })
  .strict();

const weeklySnapshotSchema = z
  .object({
    limitType: z.string().min(1).max(64),
    pct: pct,
    resetAt: isoDate,
  })
  .strict();

export const usageLogSchema = z
  .object({
    deviceUuid: z.string().min(8).max(64),
    occurredAt: isoDate,
    sessionDelta: pct,
    weeklyDeltas: z.array(weeklyDeltaSchema).max(10).default([]),
    sessionPctAfter: pct.optional(),
    sessionResetAt: isoDate.optional(),
    weeklySnapshots: z.array(weeklySnapshotSchema).max(10).default([]),
  })
  .strict();

export const usageResetSchema = z
  .object({
    scope: z.enum(['session', 'weekly', 'all']),
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    warnSession: pct.optional(),
    blockSession: pct.optional(),
    warnWeekly: pct.optional(),
    blockWeekly: pct.optional(),
    hardBlockEnabled: z.boolean().optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export type UsageLogBody = z.infer<typeof usageLogSchema>;
export type SettingsPatchBody = z.infer<typeof settingsPatchSchema>;
