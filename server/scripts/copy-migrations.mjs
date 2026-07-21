// Copy SQL migrations (and drizzle's meta journal) into dist so the compiled
// server can run them without the src tree present.
import { cpSync } from 'node:fs';

cpSync(
  new URL('../src/db/migrations', import.meta.url),
  new URL('../dist/db/migrations', import.meta.url),
  { recursive: true },
);
console.log('migrations copied to dist/db/migrations');
