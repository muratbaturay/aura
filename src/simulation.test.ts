import { describe, it, expect } from 'vitest';
import { ELEANOR, residentById, type Resident } from './residents';
import { defaultState } from './baseline';
import { selectIntervention } from './intervention';
import { assess } from './assessment';
import { createRng } from './rng';
import { simulate24h, startStateFor } from './simulation';
import { valueAt, SCENARIOS, type Scenario } from './scenarios';

const TEST_SCENARIO: Scenario = {
  id: 'test', name: 'Test', description: '', seed: 1, useWearables: true, chapters: [], residentId: 'eleanor',
  keyframes: { speechDrift: [[0, 20], [12, 80]], heartRate: [[0, 70], [23, 115]] },
};
const run = (seed: number, scenario?: Scenario, initial = defaultState()) =>
  simulate24h(ELEANOR, initial, { rng: createRng(seed), scenario });

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
        const { alert } = assess(s.state, ELEANOR);
        expect(s.intervention.level).toBe(selectIntervention(s.state, alert, s.highStreak, ELEANOR).level);
        expect(s.alert).toEqual(alert);
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
    return simulate24h(residentById(sc.residentId), defaultState(), { rng: createRng(sc.seed), scenario: sc });
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
    const snaps = run(3, { ...TEST_SCENARIO, useWearables: false, keyframes: { mobility: [[0, 40], [23, 40]] } });
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
    // A day built to sit where no single concern is Medium but together they are
    const snaps = run(3, { ...TEST_SCENARIO, useWearables: false, keyframes: { speechDrift: [[0, 42], [23, 42]], socialIsolation: [[0, 44], [23, 44]] } });
    const combinedOnly = snaps.filter(s => s.alert.overall >= 40 && s.alert.fall < 40 && s.alert.cognitive < 40 && s.alert.loneliness < 40);
    expect(combinedOnly.length).toBeGreaterThan(0);
    for (const s of combinedOnly) {
      const driver = s.events.find(e => /main driver/i.test(e.detail));
      expect(driver?.urgency, `${s.hour}:00`).toBe('Low');
    }
  });
});

describe('random days sleep', () => {
  const days = (start = defaultState(), n = 120) =>
    Array.from({ length: n }, (_, i) => simulate24h(ELEANOR, start, { rng: createRng(i + 1) }));
  const daysFor = (r: Resident, n = 150) =>
    Array.from({ length: n }, (_, i) => simulate24h(r, r.usual, { rng: createRng(i + 1) }));
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
    const nights = daysFor(residentById('walter')).flatMap(d => NIGHT.map(h => d[h]));
    const share = nights.filter(s => s.risks.fall >= 70).length / nights.length;
    expect(share).toBeLessThan(0.4);
  });
});

describe('residents on random days', () => {
  const daysFor = (r: Resident, n = 150) =>
    Array.from({ length: n }, (_, i) => simulate24h(r, r.usual, { rng: createRng(i + 1) }));
  const emptyShare = (r: Resident) => daysFor(r).filter(d => d.every(s => s.events.length === 0)).length / 150;

  it('gives Eleanor mostly eventful days, and the others more so', () => {
    // Eleanor is the healthy one: about a third of her days are quiet, as they should be
    expect(emptyShare(ELEANOR)).toBeLessThan(0.4);
    for (const id of ['walter', 'margaret', 'joseph']) expect(emptyShare(residentById(id)), id).toBeLessThan(0.25);
  });

  it('does not keep Walter at Level 3+ through most of his nights', () => {
    const nights = daysFor(residentById('walter')).flatMap(d => [0, 1, 2, 3, 4, 5, 22, 23].map(h => d[h]));
    expect(nights.filter(s => s.intervention.level >= 3).length / nights.length).toBeLessThan(0.4);
  });

  it('varies from seed to seed: some days carry an off episode', () => {
    const peaks = daysFor(ELEANOR).map(d => Math.max(...d.map(s => s.alert.overall)));
    expect(peaks.filter(p => p >= 40).length).toBeGreaterThan(30);
    expect(peaks.filter(p => p < 20).length).toBeGreaterThan(30);
  });

  it('starts a story from its own resident', () => {
    const sc = SCENARIOS.find(s => s.id === 'restless-night')!;
    const walter = residentById('walter');
    const snaps = simulate24h(walter, ELEANOR.usual, { rng: createRng(1), scenario: sc });
    expect(snaps[12].state.mobility).toBeGreaterThan(walter.usual.mobility - 10);
    expect(snaps[12].state.mobility).toBeLessThan(walter.usual.mobility + 10);
  });
});

describe('final review fixes: events', () => {
  it("never names another resident in AURA's action log", () => {
    const walter = residentById('walter');
    const details = Array.from({ length: 60 }, (_, i) => simulate24h(walter, walter.usual, { rng: createRng(i + 1) }))
      .flatMap(d => d.flatMap(s => s.events.map(e => e.detail)));
    expect(details.some(d => /Gentle prompt to Walter/.test(d))).toBe(true);
    expect(details.some(d => /Eleanor/.test(d))).toBe(false);
  });

  it('does not claim a main driver when a red flag set the level', () => {
    const joseph = residentById('joseph');
    const days = Array.from({ length: 80 }, (_, i) => simulate24h(joseph, joseph.usual, { rng: createRng(i + 1) }));
    for (const s of days.flat()) {
      if (s.alert.fall < 40 && s.alert.cognitive < 40 && s.alert.loneliness < 40 && s.state.spO2 < 92) {
        const combined = Math.max(s.alert.fall, s.alert.cognitive, s.alert.loneliness);
        if (combined * 1.2 < 40) expect(s.events.some(e => /main driver/i.test(e.detail)), `${s.hour}:00`).toBe(false);
      }
    }
  });
});
