import type { AgentConfig } from './config.js';

// Claude Split backend client. Only usage numbers, timestamps, and the
// device name ever travel here — never the Claude cookie (§7.4 hard rule).

type ApiResult = {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
};

async function call(
  config: AgentConfig,
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.backendToken}`,
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${config.backendUrl}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    return { ok: false, status: 0, json: null };
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    // empty body
  }
  return { ok: response.ok, status: response.status, json };
}

export const backend = {
  registerDevice: (config: AgentConfig, deviceUuid: string) =>
    call(config, '/devices/register', {
      method: 'POST',
      body: { deviceUuid, name: config.deviceName, kind: 'claude-code' },
    }),
  logEvent: (config: AgentConfig, body: Record<string, unknown>, idempotencyKey: string) =>
    call(config, '/usage/log', { method: 'POST', body, idempotencyKey }),
};
