import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks } from './risk';
import { selectIntervention } from './intervention';
import { createRng } from './rng';
import { simulate24h, startStateFor } from './simulation';
import { valueAt, SCENARIOS, type Scenario } from './scenarios';

const TEST_SCENARIO: Scenario = {
  id: 'test', name: 'Test', description: '', seed: 1, useWearables: true, chapters: [],
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

describe('startStateFor', () => {
  const current = { ...defaultState(), mobility: 22, timeOfDay: 23 };
  const earlier = { ...defaultState(), mobility: 70, timeOfDay: 14 };

  it('reuses the previous run\'s starting state when the same seed runs again', () => {
    expect(startStateFor(123, current, { seed: 123, start: earlier })).toEqual(earlier);
  });

  it('starts from the current state for a new seed or the first run', () => {
    expect(startStateFor(456, current, { seed: 123, start: earlier })).toEqual(current);
    expect(startStateFor(123, current, null)).toEqual(current);
  });

  it('makes a typed-back random-day seed replay that day exactly', () => {
    const firstStart = defaultState();
    const first = run(123, undefined, firstStart);
    const endOfDay = { ...first[23].state };             // where the page is left after the run
    const replay = run(123, undefined, startStateFor(123, endOfDay, { seed: 123, start: firstStart }));
    expect(replay).toEqual(first);
  });
});

describe('events', () => {
  const story = (id: string) => {
    const sc = SCENARIOS.find(s => s.id === id)!;
    return simulate24h(DEFAULT_BASELINE, defaultState(), { rng: createRng(sc.seed), scenario: sc });
  };
  const labelsAt = (snaps: ReturnType<typeof story>, hour: number) => snaps[hour].events.map(e => e.label);

  it('logs AURA acting at each change to Level 2 or above', () => {
    // Sundowning at its default seed: Level 2 from 17:00, 3 from 19:00, 4 from 21:00
    const snaps = story('sundowning');
    const acted = snaps.filter(s => s.events.some(e => e.label === 'AURA acted')).map(s => s.hour);
    expect(acted).toEqual([17, 19, 21]);
  });

  it('logs confusion while cognitive concern is Medium or High', () => {
    const snaps = story('sundowning');
    for (const h of [17, 18, 20]) expect(labelsAt(snaps, h), `hour ${h}`).toContain('Confusion signs');
    expect(labelsAt(snaps, 10)).not.toContain('Confusion signs');
  });

  it('logs moderate fall risk too, with its band as the severity', () => {
    const snaps = run(3, { ...TEST_SCENARIO, useWearables: false, keyframes: { mobility: [[0, 35], [23, 35]] } });
    const fall = snaps.flatMap(s => s.events).filter(e => e.label === 'Fall risk elevated');
    expect(fall.length).toBeGreaterThan(0);
    expect(fall.some(e => e.urgency === 'Medium')).toBe(true);
  });

  it('logs amber or red vitals', () => {
    const snaps = run(3, { ...TEST_SCENARIO, keyframes: { heartRate: [[0, 125], [23, 125]] } });
    expect(snaps.every(s => s.events.some(e => e.label === 'Vitals flag' && e.urgency === 'High'))).toBe(true);
  });

  it('explains every Level 2+ hour of every story and random day with at least one event', () => {
    const days = [
      ...SCENARIOS.map(sc => ({ name: sc.id, snaps: story(sc.id) })),
      ...Array.from({ length: 150 }, (_, i) => ({ name: `random ${i + 1}`, snaps: run(i + 1) })),
    ];
    for (const { name, snaps } of days) {
      for (const s of snaps.filter(sn => sn.intervention.level >= 2)) {
        expect(s.events.length, `${name} ${s.hour}:00`).toBeGreaterThan(0);
      }
    }
  });

  it('names the driving concern when only the combined score is Medium', () => {
    // UTI 16:00 at its default seed: cognitive 39 (Low), overall 44 (Medium)
    const e = story('uti')[16].events.find(ev => ev.label === 'Confusion signs');
    expect(e?.urgency).toBe('Low');
    expect(e?.detail).toMatch(/main driver/i);
  });
});

describe('random days sleep', () => {
  const days = (start = defaultState(), n = 120) =>
    Array.from({ length: n }, (_, i) => simulate24h(DEFAULT_BASELINE, start, { rng: createRng(i + 1) }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const NIGHT = [0, 1, 2, 3, 4, 5, 22, 23];

  it('settles at night: restlessness averages below 25 between 01:00 and 04:00', () => {
    const r = days().flatMap(d => [1, 2, 3, 4].map(h => d[h].state.restlessness));
    expect(mean(r)).toBeLessThan(25);
  });

  it('stays near her usual levels through the day', () => {
    const day = days().flatMap(d => d.slice(9, 20));
    expect(Math.abs(mean(day.map(s => s.state.restlessness)) - 25)).toBeLessThan(8);
    expect(Math.abs(mean(day.map(s => s.state.mobility)) - 70)).toBeLessThan(8);
  });

  it('gets up on a minority of night hours', () => {
    const nights = days().flatMap(d => NIGHT.map(h => d[h]));
    const share = nights.filter(s => s.events.some(e => e.label === 'Bed exit detected')).length / nights.length;
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.35);
  });

  it('reads High fall risk on well under half the night hours for a frail resident', () => {
    const nights = days({ ...defaultState(), mobility: 25, restlessness: 60 }).flatMap(d => NIGHT.map(h => d[h]));
    const share = nights.filter(s => s.risks.fall >= 70).length / nights.length;
    expect(share).toBeLessThan(0.4);
  });
});
