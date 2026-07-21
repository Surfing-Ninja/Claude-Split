import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { devices } from '../db/schema.js';

/**
 * Owner-device rule: the first device registered on an account is the owner;
 * only requests from a token bound to that device may change settings, reset
 * counters, or delete the account.
 *
 * A user with no devices yet (fresh account, curl setup) passes the check —
 * there is nobody to protect from. This is a guardrail against accidental or
 * family edits, not a cryptographic boundary: every device already holds the
 * account password.
 */
export async function isOwnerRequest(
  db: Db,
  userId: string,
  sessionDeviceId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: devices.id, role: devices.role })
    .from(devices)
    .where(eq(devices.userId, userId));
  if (rows.length === 0) return true;
  if (!sessionDeviceId) return false;
  return rows.some((d) => d.id === sessionDeviceId && d.role === 'owner');
}

export const OWNER_ONLY_ERROR = 'only the owner device can do this';
