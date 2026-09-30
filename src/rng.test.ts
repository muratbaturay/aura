import { describe, it, expect } from 'vitest';
import { createRng, parseSeed } from './rng';

describe('createRng', () => {
  const take = (seed: number, n = 5) => { const r = createRng(seed); return Array.from({ length: n }, r); };

  it('repeats the same sequence for the same seed', () => {
    expect(take(42)).toEqual(take(42));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays in [0, 1) for edge-case seeds', () => {
    for (const seed of [0, -7, 3.7, 1e12, Number.MAX_SAFE_INTEGER]) {
      for (const v of take(seed, 200)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('parseSeed', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['abc', null],
    ['42', 42],
    [' 42 ', 42],
    ['-5', 5],
    ['3.7', 3],
  ] as const)('%j → %s', (text, expected) => {
    expect(parseSeed(text)).toBe(expected);
  });
});
