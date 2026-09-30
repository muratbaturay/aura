import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE } from './baseline';
import { ringSegments, ringGradient, nightArcGradient, ringPoint } from './ring';
import type { InterventionLevel } from './types';

const levels: (InterventionLevel | null)[] = [2, 3, ...Array<null>(22).fill(null)];

describe('ringSegments', () => {
  it('colours hours with data by level and the rest as future', () => {
    const segs = ringSegments(levels, 1, DEFAULT_BASELINE);
    expect(segs).toHaveLength(24);
    expect(segs.slice(0, 3).map(s => s.fill)).toEqual([2, 3, 'future']);
  });
  it('marks the current hour and the night hours', () => {
    const segs = ringSegments(levels, 1.5, DEFAULT_BASELINE);
    expect(segs.filter(s => s.isNow).map(s => s.hour)).toEqual([1]);
    expect(segs.filter(s => s.isNight).map(s => s.hour)).toEqual([0, 1, 2, 3, 4, 5, 22, 23]);
  });
});

describe('ringGradient', () => {
  it('draws each hour as a 15° slice with 1° gaps, from 00 at the top', () => {
    const g = ringGradient(ringSegments(levels, 1, DEFAULT_BASELINE));
    expect(g.startsWith('conic-gradient(')).toBe(true);
    expect(g).toContain('var(--c-level-2) 1deg 14deg');
    expect(g).toContain('var(--c-level-3) 16deg 29deg');
    expect(g).toContain('var(--ring-future) 31deg 44deg');
  });
  it('marks night hours on the outer arc', () => {
    const g = nightArcGradient(ringSegments(levels, 1, DEFAULT_BASELINE));
    expect(g).toContain('var(--ring-night) 0deg 15deg');
    expect(g).toContain('transparent 90deg 105deg');
    expect(g).toContain('var(--ring-night) 330deg 345deg');
  });
});

describe('ringPoint', () => {
  it.each([[0, 200, 100], [6, 300, 200], [12, 200, 300], [18, 100, 200]] as const)(
    'hour %s sits at (%s, %s)', (h, x, y) => {
      const p = ringPoint(h, 100, 200);
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBeCloseTo(y, 6);
    });
});
