import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { QUEUE_PATH } from './config.js';

// Offline-safe event queue, persisted to ~/.claude-split/queue.json so
// nothing is lost across agent restarts (same semantics as the extension).

export type QueuedEvent = {
  idempotencyKey: string;
  body: Record<string, unknown>;
};

const MAX_QUEUE_LENGTH = 500;

export function loadQueue(path = QUEUE_PATH): QueuedEvent[] {
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    return []; // corrupt queue file — start fresh rather than crash
  }
}

export function saveQueue(queue: QueuedEvent[], path = QUEUE_PATH): void {
  const trimmed = queue.slice(-MAX_QUEUE_LENGTH);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
