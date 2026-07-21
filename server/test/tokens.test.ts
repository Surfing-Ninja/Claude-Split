import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, tokenHashesEqual } from '../src/lib/tokens.js';

describe('opaque tokens', () => {
  it('generates 32-byte url-safe tokens, unique across calls', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url').length).toBe(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically to sha256 hex', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toBe(hashToken(t + 'x'));
  });

  it('compares hashes in constant time without throwing on garbage', () => {
    const h = hashToken(generateToken());
    expect(tokenHashesEqual(h, h)).toBe(true);
    expect(tokenHashesEqual(h, hashToken(generateToken()))).toBe(false);
    expect(tokenHashesEqual(h, 'short')).toBe(false);
  });
});
