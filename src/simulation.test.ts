import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks } from './risk';
import { selectIntervention } from './intervention';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { valueAt, type Scenario } from './scenarios';

const TEST_SCENARIO: Scenario = {
  id: 'test', name: 'Test', description: '', seed: 1, useWearables: true,
  keyframes: { speechDrift: [[0, 20], [12, 80]], heartRate: [[0, 70], [23, 115]] },
};
const run = (seed: number, scenario?: Scenario, initial = defaultState()) =>
  simulate24h(DEFAULT_BASELINE, initial, { rng: createRng(seed), scenario });

describe('valueAt', () => {
  const k: [number, number][] = [[4, 10], [8, 30], [10, 20]];
  it.each([[0, 10], [4, 10], [6, 20], [8, 30], [9, 25], [10, 20], [23, 20]])('hour %s → %s', (h, v) => {
    expect(valueAt(k, h)).toBeCloseTo(v, 9);
  });
});

describe('simulate24h', () => {
  it('replays a random day exactly for the same seed', () => {
    expect(run(7)).toEqual(run(7));
  });

  it('gives a different random day for a different seed', () => {
    expect(run(7).map(s => s.state.mobility)).not.toEqual(run(8).map(s => s.state.mobility));
  });

  it('replays a scenario exactly for the same seed', () => {
    expect(run(3, TEST_SCENARIO)).toEqual(run(3, TEST_SCENARIO));
  });

  it('ignores the slider state when a scenario runs', () => {
    const odd = { ...defaultState(), mobility: 5, socialIsolation: 95, useWearables: false };
    expect(run(3, TEST_SCENARIO, odd)).toEqual(run(3, TEST_SCENARIO));
  });

  it('follows the keyframes within the noise band', () => {
    const snaps = run(3, TEST_SCENARIO);
    expect(snaps).toHaveLength(24);
    expect(snaps[12].state.speechDrift).toBeGreaterThanOrEqual(77);
    expect(snaps[12].state.speechDrift).toBeLessThanOrEqual(83);
    expect(snaps[0].state.useWearables).toBe(true);
    expect(snaps[5].state.mobility).toBe(defaultState().mobility); // un-keyframed signal stays put
  });

  it('records the High streak each hour used, matching the level it shows', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const snaps = run(seed, TEST_SCENARIO);
      expect(snaps[0].highStreak).toBe(0);
      for (const s of snaps) {
        const risks = computeRisks(s.state, computeDeviations(DEFAULT_BASELINE, s.state), DEFAULT_BASELINE);
        expect(s.intervention.level).toBe(selectIntervention(s.state, risks, s.highStreak).level);
      }
    }
  });
});
