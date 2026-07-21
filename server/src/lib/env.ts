export type Env = {
  databaseUrl: string;
  port: number;
  corsOrigins: string[];
  tokenTtlDays: number;
  retentionDays: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (see .env.example)');
  }
  return {
    databaseUrl,
    port: parsePositiveInt(source.PORT, 8080),
    corsOrigins: (source.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tokenTtlDays: parsePositiveInt(source.TOKEN_TTL_DAYS, 30),
    retentionDays: parsePositiveInt(source.RETENTION_DAYS, 90),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
