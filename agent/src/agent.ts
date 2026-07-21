import { watch } from 'chokidar';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { computeDelta, type Snapshot } from './attribution.js';
import { backend } from './backend.js';
import { ClaudeAuthError, fetchUsage } from './claude-usage.js';
import { CONFIG_DIR, TRANSCRIPTS_DIR, loadConfig, type AgentConfig } from './config.js';
import { loadQueue, saveQueue, type QueuedEvent } from './queue.js';
import { isUserSend, splitCompleteLines } from './transcripts.js';

const POLL_INTERVAL_MS = 3 * 60 * 1000;
const SNAPSHOT_FRESH_MS = 60 * 1000;
const AFTER_POLL_DELAYS_MS = [15_000, 30_000];
const DEVICE_ID_PATH = join(CONFIG_DIR, 'device-id');

const COOKIE_EXPIRED_MESSAGE = `
╭──────────────────────────────────────────────────────────────╮
│  Claude session cookie expired or was rejected.              │
│                                                              │
│  Refresh it: log in at https://claude.ai, copy the           │
│  "sessionKey" cookie value again (see README), paste it      │
│  into ~/.claude-split/config.json, then restart the agent.   │
│                                                              │
│  The agent will NOT retry on its own.                        │
╰──────────────────────────────────────────────────────────────╯
`;

type PendingSend = { before: Snapshot | null; startedAt: string; attempts: number };

export class Agent {
  private config: AgentConfig;
  private deviceUuid: string;
  private latest: Snapshot | null = null;
  private pending: PendingSend | null = null;
  private queue: QueuedEvent[];
  private fileOffsets = new Map<string, number>();
  private timers: NodeJS.Timeout[] = [];

  constructor(config: AgentConfig) {
    this.config = config;
    this.deviceUuid = loadOrCreateDeviceId();
    this.queue = loadQueue();
  }

  async start(): Promise<void> {
    console.log(`claude-split-agent — device "${this.config.deviceName}" (${this.deviceUuid})`);
    console.log('Privacy: transcript text is never read; only entry types are classified.');

    const registered = await backend.registerDevice(this.config, this.deviceUuid);
    if (registered.status === 401) {
      fatal('Backend rejected the token in config.json — log in again and update backendToken.');
    }
    if (!registered.ok && registered.status !== 0) {
      console.warn(`warning: device registration returned ${registered.status}; will retry later`);
    }

    this.latest = await this.poll();
    if (this.latest) {
      console.log(`Baseline: session at ${(this.latest.sessionPct * 100).toFixed(1)}%`);
    } else {
      console.warn('warning: could not fetch a usage baseline yet (offline?)');
    }

    if (!existsSync(TRANSCRIPTS_DIR)) {
      fatal(
        `Claude Code transcripts directory not found: ${TRANSCRIPTS_DIR}\n` +
          'Is Claude Code installed and has it been run at least once on this machine?',
      );
    }

    const watcher = watch(TRANSCRIPTS_DIR, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    watcher.on('add', (path) => {
      if (!path.endsWith('.jsonl')) return;
      // existing content predates the agent — start at end of file
      this.fileOffsets.set(path, safeSize(path));
    });
    watcher.on('change', (path) => {
      if (!path.endsWith('.jsonl')) return;
      void this.onTranscriptAppend(path);
    });
    watcher.on('error', (err) => console.warn('watcher error:', err));

    const pollTimer = setInterval(() => void this.pollAndFlush(), POLL_INTERVAL_MS);
    this.timers.push(pollTimer);
    console.log(`Watching ${TRANSCRIPTS_DIR} for Claude Code activity…`);
  }

  private async onTranscriptAppend(path: string): Promise<void> {
    const previousOffset = this.fileOffsets.get(path) ?? 0;
    const size = safeSize(path);
    if (size <= previousOffset) {
      if (size < previousOffset) this.fileOffsets.set(path, size); // truncated/rotated
      return;
    }
    let text = '';
    try {
      const fh = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(size - previousOffset);
        await fh.read(buffer, 0, buffer.length, previousOffset);
        text = buffer.toString('utf8');
      } finally {
        await fh.close();
      }
    } catch {
      return;
    }
    const { lines, rest } = splitCompleteLines(text);
    this.fileOffsets.set(path, size - Buffer.byteLength(rest, 'utf8'));

    const sends = lines.filter(isUserSend).length;
    if (sends > 0) {
      console.log(`Detected ${sends} Claude Code send(s)`);
      this.onSendDetected();
    }
  }

  private onSendDetected(): void {
    if (this.pending) return; // coalesce rapid sends onto the earliest baseline
    const fresh =
      this.latest && Date.now() - new Date(this.latest.capturedAt).getTime() < SNAPSHOT_FRESH_MS;
    this.pending = {
      before: fresh ? this.latest : null,
      startedAt: new Date().toISOString(),
      attempts: 0,
    };
    if (!fresh) {
      // baseline stale → poll immediately; /usage generally still shows the
      // pre-send value while Claude Code's completion is in flight
      void this.poll().then((snap) => {
        if (this.pending && !this.pending.before) this.pending.before = snap ?? this.latest;
      });
    }
    this.scheduleAfterPoll();
  }

  private scheduleAfterPoll(): void {
    const pending = this.pending;
    if (!pending) return;
    const delay = AFTER_POLL_DELAYS_MS[Math.min(pending.attempts, AFTER_POLL_DELAYS_MS.length - 1)];
    const timer = setTimeout(() => void this.settlePending(), delay);
    this.timers.push(timer);
  }

  private async settlePending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    pending.attempts += 1;
    const after = (await this.poll()) ?? this.latest;
    if (!after || !pending.before) {
      this.pending = null;
      return;
    }
    const change = computeDelta(pending.before, after);
    const unchanged =
      change.kind === 'delta' && change.sessionDelta === 0 && change.weeklyDeltas.length === 0;
    if (unchanged && pending.attempts < AFTER_POLL_DELAYS_MS.length) {
      this.scheduleAfterPoll(); // numbers not updated yet — one more try
      return;
    }
    this.pending = null;
    if (change.kind === 'delta' && !unchanged) {
      console.log(`Attributed +${(change.sessionDelta * 100).toFixed(2)}% session usage`);
      this.enqueue({
        deviceUuid: this.deviceUuid,
        occurredAt: pending.startedAt,
        sessionDelta: change.sessionDelta,
        weeklyDeltas: change.weeklyDeltas,
        sessionPctAfter: after.sessionPct,
        sessionResetAt: after.sessionResetAt ?? undefined,
        weeklySnapshots: (after.weekly ?? []).map((w) => ({
          limitType: w.limitType,
          pct: w.pct,
          resetAt: w.resetAt,
        })),
      });
      await this.flush();
    } else if (change.kind === 'reset') {
      console.log('Session window reset mid-send — delta discarded');
    }
  }

  private async poll(): Promise<Snapshot | null> {
    try {
      const snapshot = await fetchUsage(this.config);
      if (snapshot) this.latest = snapshot;
      return snapshot;
    } catch (err) {
      if (err instanceof ClaudeAuthError) {
        // §7.4: stop, print clearly, never retry-loop.
        console.error(COOKIE_EXPIRED_MESSAGE);
        this.stop();
        process.exitCode = 1;
        // give the message a beat to flush, then hard-exit
        setTimeout(() => process.exit(1), 50);
        return null;
      }
      return null;
    }
  }

  private async pollAndFlush(): Promise<void> {
    await this.poll();
    await this.flush();
  }

  private enqueue(body: Record<string, unknown>): void {
    this.queue.push({ idempotencyKey: randomUUID(), body });
    saveQueue(this.queue);
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue[0]!;
      const result = await backend.logEvent(this.config, item.body, item.idempotencyKey);
      if (result.ok) {
        this.queue.shift();
        saveQueue(this.queue);
        continue;
      }
      if (result.status === 401) {
        console.warn('Backend token rejected — events stay queued. Update backendToken in config.');
        return;
      }
      if (result.status === 404) {
        // device not registered (fresh backend) — register and retry next flush
        await backend.registerDevice(this.config, this.deviceUuid);
        return;
      }
      if (result.status === 400) {
        this.queue.shift(); // permanently rejected — drop
        saveQueue(this.queue);
        continue;
      }
      return; // network/5xx — keep queue, try again on next poll tick
    }
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}

function loadOrCreateDeviceId(): string {
  try {
    if (existsSync(DEVICE_ID_PATH)) {
      const id = readFileSync(DEVICE_ID_PATH, 'utf8').trim();
      if (id) return id;
    }
  } catch {
    // fall through to create
  }
  const id = randomUUID();
  try {
    writeFileSync(DEVICE_ID_PATH, id + '\n', { mode: 0o600 });
  } catch {
    // non-fatal: id just won't be stable across restarts
  }
  return id;
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function fatal(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export async function main(): Promise<void> {
  let config: AgentConfig;
  try {
    config = loadConfig();
  } catch (err) {
    fatal(String((err as Error).message ?? err));
  }
  const agent = new Agent(config);
  await agent.start();
}
