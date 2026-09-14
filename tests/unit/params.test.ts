import { describe, expect, it } from 'vitest';
import { addressWithSeed, resolveParams, shareAddress } from '../../src/page/Params';

describe('resolveParams', () => {
  it('reads an explicit seed and flags', () => {
    const p = resolveParams('?seed=42&webgl=1&profile=1&dev=1');
    expect(p).toEqual({ seed: 42, forceWebGL: true, profiling: true, dev: true });
  });
  it('falls back to the remembered seed, then to a random 32-bit one', () => {
    expect(resolveParams('', () => 0.5, 7).seed).toBe(7);
    expect(resolveParams('', () => 0.5, null).seed).toBe(2147483648);
    expect(resolveParams('?seed=abc', () => 0.25).seed).toBe(1073741824);
  });
  it('wraps a negative or oversized seed to an unsigned 32-bit integer', () => {
    expect(resolveParams('?seed=-1').seed).toBe(4294967295);
    expect(resolveParams('?seed=4294967296').seed).toBe(0);
  });
  it('flags default to off', () => {
    const p = resolveParams('?seed=1');
    expect(p.forceWebGL).toBe(false);
    expect(p.profiling).toBe(false);
    expect(p.dev).toBe(false);
  });
});

describe('addresses', () => {
  it('writes the seed into the current address and keeps the other parameters', () => {
    expect(addressWithSeed('https://x.test/fly/?webgl=1', 42)).toBe('https://x.test/fly/?webgl=1&seed=42');
    expect(addressWithSeed('https://x.test/fly/?seed=1&dev=1', 42)).toBe('https://x.test/fly/?seed=42&dev=1');
  });
  it('builds a share link with the seed alone', () => {
    expect(shareAddress('https://x.test/fly/?webgl=1&profile=1#top', 42)).toBe('https://x.test/fly/?seed=42');
  });
});
