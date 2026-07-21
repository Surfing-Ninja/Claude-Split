import type { Snapshot, WeeklyWindow } from './attribution.js';
import type { AgentConfig } from './config.js';

// Claude endpoint knowledge for the agent. Mirrors
// extension/src/lib/usage-parser.js — update both together when Anthropic's
// frontend changes. Technique credit: she-llac/claude-counter (MIT).

export class ClaudeAuthError extends Error {
  constructor() {
    super('Claude session cookie rejected (401/403)');
  }
}

const SESSION_KEY = 'five_hour';
const WEEKLY_KEY_PREFIX = 'seven_day';

function normalizePct(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, pct));
}

function normalizeResetAt(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readWindow(obj: unknown): { pct: number; resetAt: string | null } | null {
  if (obj == null || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const pct = normalizePct(rec.utilization ?? rec.pct ?? rec.percentage);
  const resetAt = normalizeResetAt(rec.resets_at ?? rec.resetsAt ?? rec.reset_at ?? rec.resetAt);
  if (pct == null) return null;
  return { pct, resetAt };
}

export function parseUsageResponse(json: unknown, source = 'poll'): Snapshot | null {
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return null;
  const rec = json as Record<string, unknown>;

  const session = readWindow(rec[SESSION_KEY]);
  const weekly: WeeklyWindow[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (key === SESSION_KEY || !key.startsWith(WEEKLY_KEY_PREFIX)) continue;
    const win = readWindow(value);
    if (!win) continue;
    const limitType =
      key === WEEKLY_KEY_PREFIX ? 'all_models' : key.slice(WEEKLY_KEY_PREFIX.length + 1);
    weekly.push({ limitType, ...win });
  }
  if (!session && weekly.length === 0) return null;
  return {
    sessionPct: session?.pct ?? 0,
    sessionResetAt: session?.resetAt ?? null,
    weekly,
    capturedAt: new Date().toISOString(),
    source,
  };
}

/**
 * Fetch Claude's official usage numbers with the locally-stored session
 * cookie. The cookie goes to claude.ai and NOWHERE else.
 * @throws ClaudeAuthError on 401/403 — the caller must stop, not retry-loop.
 */
export async function fetchUsage(config: AgentConfig): Promise<Snapshot | null> {
  const url = `https://claude.ai/api/organizations/${encodeURIComponent(config.claudeOrgId)}/usage`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Cookie: `sessionKey=${config.claudeSessionCookie}`,
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
  } catch {
    return null; // network blip — caller keeps the last snapshot
  }
  if (response.status === 401 || response.status === 403) throw new ClaudeAuthError();
  if (!response.ok) return null;
  try {
    return parseUsageResponse(await response.json());
  } catch {
    return null;
  }
}
