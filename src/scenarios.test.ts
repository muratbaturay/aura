import { describe, it, expect } from 'vitest';
import { residentById } from './residents';
import { defaultState } from './baseline';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { SCENARIOS } from './scenarios';

// [hour, allowed levels]; hours chosen well clear of transitions
const TARGETS: Record<string, [number, number[]][]> = {
  sundowning: [[2, [1]], [10, [1]], [13, [1]], [17, [2]], [20, [3, 4]], [22, [4]], [23, [4]]],
  uti: [[3, [3, 4]], [8, [4]], [10, [4]], [15, [2]], [20, [1]], [23, [1]]],
  withdrawn: [[2, [1]], [7, [1]], [13, [2]], [17, [2]], [21, [2]]],
  'restless-night': [[2, [3, 4]], [4, [4]], [5, [4]], [12, [1]], [16, [1]], [23, [1]]],
};
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

describe('scenario stories', () => {
  it('has exactly the four stories', () => {
    expect(SCENARIOS.map(s => s.id).sort()).toEqual(Object.keys(TARGETS).sort());
  });

  for (const [id, targets] of Object.entries(TARGETS)) {
    it(`${id} hits its target levels for 200 seeds and its default seed`, () => {
      const scenario = SCENARIOS.find(s => s.id === id)!;
      for (const seed of [scenario.seed, ...SEEDS]) {
        const snaps = simulate24h(residentById(scenario.residentId), defaultState(), { rng: createRng(seed), scenario });
        for (const [hour, allowed] of targets) {
          expect(allowed, `${id} seed ${seed} hour ${hour}`).toContain(snaps[hour].intervention.level);
        }
      }
    });
  }

  it('gives every story 2–4 chapters in hour order within the day', () => {
    for (const sc of SCENARIOS) {
      const hours = sc.chapters.map(c => c.hour);
      expect(hours.length, sc.id).toBeGreaterThanOrEqual(2);
      expect(hours.length, sc.id).toBeLessThanOrEqual(4);
      expect(hours, sc.id).toEqual([...hours].sort((a, b) => a - b));
      for (const h of hours) expect(h >= 0 && h <= 23, `${sc.id} ${h}`).toBe(true);
    }
  });

  it('turns wearables on for the UTI story and for Joseph', () => {
    expect(SCENARIOS.filter(s => s.useWearables).map(s => s.id)).toEqual(['uti', 'withdrawn']);
  });

  it('belongs each story to its resident', () => {
    expect(Object.fromEntries(SCENARIOS.map(s => [s.id, s.residentId]))).toEqual({
      sundowning: 'margaret', uti: 'eleanor', withdrawn: 'joseph', 'restless-night': 'walter',
    });
  });
});
