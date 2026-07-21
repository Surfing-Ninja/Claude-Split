import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';

// ~/.claude-split/config.json — created chmod 600. The Claude session cookie
// lives ONLY in this file on this machine; it is sent to claude.ai and
// nowhere else (§7.4 hard rule). Only computed deltas go to the backend.

export type AgentConfig = {
  claudeSessionCookie: string;
  claudeOrgId: string;
  backendUrl: string;
  backendToken: string;
  deviceName: string;
};

export const CONFIG_DIR = join(homedir(), '.claude-split');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const QUEUE_PATH = join(CONFIG_DIR, 'queue.json');
export const TRANSCRIPTS_DIR = join(homedir(), '.claude', 'projects');

const TEMPLATE: AgentConfig = {
  claudeSessionCookie: 'PASTE the value of the `sessionKey` cookie from claude.ai (see README)',
  claudeOrgId: 'PASTE the value of the `lastActiveOrg` cookie from claude.ai',
  backendUrl: 'https://your-claude-split-backend.example.com',
  backendToken: 'PASTE the token from the extension popup or /auth/login',
  deviceName: `${hostname()} — Claude Code`,
};

export function writeTemplate(): string {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(TEMPLATE, null, 2) + '\n', { mode: 0o600 });
  }
  chmodSync(CONFIG_PATH, 0o600);
  return CONFIG_PATH;
}

export function loadConfig(): AgentConfig {
  if (!existsSync(CONFIG_PATH)) {
    writeTemplate();
    throw new Error(
      `No config found. A template was created at ${CONFIG_PATH} — fill it in and rerun.\n` +
        `Step-by-step cookie instructions: see the claude-split README (agent section).`,
    );
  }
  chmodSync(CONFIG_PATH, 0o600); // re-assert on every start
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AgentConfig>;
  const required: Array<keyof AgentConfig> = [
    'claudeSessionCookie',
    'claudeOrgId',
    'backendUrl',
    'backendToken',
  ];
  for (const key of required) {
    const value = raw[key];
    if (!value || typeof value !== 'string' || value.startsWith('PASTE')) {
      throw new Error(`Config field "${key}" is missing or not filled in (${CONFIG_PATH}).`);
    }
  }
  return {
    claudeSessionCookie: raw.claudeSessionCookie!,
    claudeOrgId: raw.claudeOrgId!,
    backendUrl: raw.backendUrl!.replace(/\/+$/, ''),
    backendToken: raw.backendToken!,
    deviceName: raw.deviceName?.trim() || TEMPLATE.deviceName,
  };
}
