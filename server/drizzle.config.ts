import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile(); // ./.env when run from server/
} catch {
  // no .env — rely on real environment variables
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/claude_split',
  },
});
