import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Opaque bearer tokens (§7.3): 32 random bytes, shown to the client once,
// stored server-side only as a SHA-256 hash. Revocation = delete the row.

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenHashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
