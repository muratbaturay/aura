import { describe, it, expect } from 'vitest';
import type { CurrentState } from './types';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks, urgencyBand, vitalsFlag, buildExplanation, timeUp } from './risk';
import { selectIntervention } from './intervention';

// Default state: 14:00, all signals at baseline, staff load 40, wearables off.
function evaluate(patch: Partial<CurrentState>, highStreak = 0) {
  const state = { ...defaultState(), ...patch };
  const devs = computeDeviations(DEFAULT_BASELINE, state);
  const risks = computeRisks(state, devs, DEFAULT_BASELINE);
  const intervention = selectIntervention(state, risks, highStreak);
  const explanation = buildExplanation(state, devs, risks, DEFAULT_BASELINE);
  return { state, risks, intervention, explanation };
}

const wear = (spO2: number, heartRate: number) => ({ useWearables: true, spO2, heartRate });

describe('overall urgency', () => {
  it('is the worst domain plus 0.2 × the second-worst', () => {
    // Baseline at 14:00: fall 15.5, cognitive 9, loneliness 19.2 → 19.2 + 0.2 × 15.5
    expect(evaluate({}).risks.overall).toBeCloseTo(22.3, 1);
  });

  it('is never below the worst single domain', () => {
    const cases: Partial<CurrentState>[] = [
      {},
      { speechDrift: 100 },
      { mobility: 5, restlessness: 90 },
      { socialIsolation: 90, mobility: 20 },
      { timeOfDay: 3, restlessness: 80 },
    ];
    for (const c of cases) {
      const { risks } = evaluate(c);
      expect(risks.overall).toBeGreaterThanOrEqual(Math.max(risks.fall, risks.cognitive, risks.loneliness));
    }
  });

  it('is High when a single domain is severe', () => {
    // Speech drift 100 → cognitive ≈ 90; the old weighted average gave 39 (Low).
    expect(urgencyBand(evaluate({ speechDrift: 100 }).risks.overall)).toBe('High');
  });

  it('is floored at 70 when vitals are red', () => {
    expect(evaluate(wear(85, 135)).risks.overall).toBeGreaterThanOrEqual(70);
  });

  it('is floored at 40 when vitals are amber', () => {
    expect(urgencyBand(evaluate(wear(91, 72)).risks.overall)).toBe('Medium');
  });
});

describe('vitalsFlag', () => {
  const flag = (patch: Partial<CurrentState>) => vitalsFlag({ ...defaultState(), ...patch });

  it.each([
    [89, 72, 'red'],
    [90, 72, 'amber'],
    [91.5, 72, 'amber'],
    [92, 72, 'none'],
    [97, 121, 'red'],
    [97, 120, 'amber'],
    [97, 111, 'amber'],
    [97, 110, 'none'],
  ] as const)('SpO2 %s / HR %s → %s', (spO2, hr, expected) => {
    expect(flag(wear(spO2, hr))).toBe(expected);
  });

  it('ignores vitals when wearables are off', () => {
    expect(flag({ useWearables: false, spO2: 85, heartRate: 135 })).toBe('none');
  });
});

describe('intervention ladder', () => {
  it('stays at Level 1 when everything is at baseline', () => {
    expect(evaluate({}).intervention.level).toBe(1);
  });

  it('gives Level 2 when overall is Medium', () => {
    // Social isolation 70 → loneliness ≈ 57, overall ≈ 60
    expect(evaluate({ socialIsolation: 70 }).intervention.level).toBe(2);
  });

  it('gives Level 3 for High cognitive concern alone', () => {
    expect(evaluate({ speechDrift: 100 }).intervention.level).toBe(3);
  });

  it('gives Level 3, not 4, for High fall risk alone', () => {
    expect(evaluate({ mobility: 5, restlessness: 90 }).intervention.level).toBe(3);
  });

  it('gives Level 3 when two Medium domains compound to High overall', () => {
    // fall ≈ 32, cognitive ≈ 60, loneliness ≈ 59 → overall ≈ 72
    expect(evaluate({ mobility: 50, speechDrift: 70, socialIsolation: 70, staffLoad: 30 }).intervention.level).toBe(3);
  });

  it('gives Level 3 for amber vitals alone', () => {
    expect(evaluate(wear(91, 72)).intervention.level).toBe(3);
  });

  it('gives Level 4 for low SpO2 alone', () => {
    expect(evaluate(wear(85, 72)).intervention.level).toBe(4);
  });

  it('gives Level 4 for high heart rate alone', () => {
    expect(evaluate(wear(97, 125)).intervention.level).toBe(4);
  });

  it('gives Level 4 when two domains are High', () => {
    // fall ≈ 86, cognitive ≈ 90
    expect(evaluate({ mobility: 10, restlessness: 60, speechDrift: 100 }).intervention.level).toBe(4);
  });

  it('gives Level 4 when a High domain coincides with amber vitals', () => {
    expect(evaluate({ speechDrift: 100, ...wear(91, 72) }).intervention.level).toBe(4);
  });

  it('gives Level 4 on the third High hour in a row', () => {
    expect(evaluate({ speechDrift: 100 }, 2).intervention.level).toBe(4);
    expect(evaluate({ speechDrift: 100 }, 1).intervention.level).toBe(3);
  });

  it('drops out of Level 4 as soon as overall is no longer High, whatever the streak', () => {
    expect(evaluate({}, 5).intervention.level).toBe(1);
    expect(evaluate({ socialIsolation: 70 }, 5).intervention.level).toBe(2);
  });

  it('never changes level because of staff load', () => {
    const cases: Partial<CurrentState>[] = [
      {},
      { socialIsolation: 70 },
      { mobility: 50, speechDrift: 70, socialIsolation: 70 },
      { speechDrift: 100 },
      { mobility: 35 },
      wear(91, 72),
    ];
    for (const c of cases) {
      const low = evaluate({ ...c, staffLoad: 10 }).intervention.level;
      const high = evaluate({ ...c, staffLoad: 95 }).intervention.level;
      expect(high).toBe(low);
    }
  });
});

describe('intervention messages', () => {
  it('names cognitive concern in the Level 3 staff message when it drives the alert', () => {
    expect(evaluate({ speechDrift: 100 }).intervention.staffMessage).toMatch(/cognitive/i);
  });

  it('names the heart rate in the Level 4 staff message for a heart-rate red flag', () => {
    expect(evaluate(wear(97, 125)).intervention.staffMessage).toMatch(/125/);
  });

  it('adds a staff-load note only when staff load is high', () => {
    expect(evaluate({ speechDrift: 100, staffLoad: 80 }).intervention.staffMessage).toMatch(/staff load/i);
    expect(evaluate({ speechDrift: 100, staffLoad: 30 }).intervention.staffMessage).not.toMatch(/staff load/i);
  });

  it('uses a distinct Level 2 resident message when cognitive concern is the driver', () => {
    const cognitive = evaluate({ speechDrift: 65 }).intervention;       // cognitive ≈ 55 (Medium)
    const fall = evaluate({ mobility: 35 }).intervention;               // fall ≈ 45 (Medium)
    const lonely = evaluate({ socialIsolation: 70 }).intervention;      // loneliness ≈ 57 (Medium)
    for (const i of [cognitive, fall, lonely]) expect(i.level).toBe(2);
    expect(cognitive.residentMessage).not.toBe(fall.residentMessage);
    expect(cognitive.residentMessage).not.toBe(lonely.residentMessage);
  });

  it('explains a streak escalation in the staff message', () => {
    expect(evaluate({ speechDrift: 100 }, 2).intervention.staffMessage).toMatch(/3\+ hours in a row/);
  });
});

describe('intervention trigger', () => {
  it.each([
    [{}, 0, /Level 1: overall urgency is Low/],
    [{ socialIsolation: 70 }, 0, /Level 2: overall urgency is Medium/],
    [{ speechDrift: 100 }, 0, /Level 3: overall urgency is High/],
    [wear(91, 72), 0, /Level 3: vitals are borderline/],
    [wear(85, 72), 0, /Level 4: vitals red flag/],
    [{ mobility: 10, restlessness: 60, speechDrift: 100 }, 0, /Level 4: two or more areas are High/],
    [{ speechDrift: 100, ...wear(91, 72) }, 0, /Level 4: .*High and vitals are borderline/],
    [{ speechDrift: 100 }, 2, /Level 4: overall urgency has been High for 3\+ hours in a row/],
  ] as [Partial<CurrentState>, number, RegExp][])('names the rule that set the level (%o, High streak %s)', (patch, recent, pattern) => {
    expect(evaluate(patch, recent).intervention.trigger).toMatch(pattern);
  });
});

describe('explanation', () => {
  it('attributes exactly the Overall score across the factors', () => {
    const cases: Partial<CurrentState>[] = [
      {},
      { timeOfDay: 3 },
      { speechDrift: 100 },
      { speechDrift: 65 },
      { mobility: 5, restlessness: 90 },               // fall capped at 100, overall capped at 100
      { mobility: 5, restlessness: 90, timeOfDay: 2 },
      { mobility: 10, restlessness: 60, speechDrift: 100 },
      { mobility: 50, speechDrift: 70, socialIsolation: 70 },
      { socialIsolation: 70 },
      { socialIsolation: 100, mobility: 0, restlessness: 0 },
      { mobility: 100, restlessness: 0, speechDrift: 0, socialIsolation: 0 },
      { timeOfDay: 23, restlessness: 100, speechDrift: 80 },
      wear(91, 72),
      wear(85, 135),
      wear(97, 115),
      { ...wear(88, 125), mobility: 20, timeOfDay: 4 },
      { ...wear(99, 60), speechDrift: 90, socialIsolation: 90 },
      { staffLoad: 100 },
    ];
    for (const c of cases) {
      const { risks, explanation } = evaluate(c);
      const total = explanation.factors.reduce((sum, f) => sum + f.points, 0);
      expect(total).toBeCloseTo(risks.overall, 6);
      for (const f of explanation.factors) expect(f.points).toBeGreaterThan(0);
    }
  });

  it('ranks the factor that drives the worst area first, with its real points', () => {
    // Speech drift 100 → cognitive = 100 × 0.45 + (80 / √50) × 4 ≈ 90.25, all from speech
    const top = evaluate({ speechDrift: 100 }).explanation.topFactors[0];
    expect(top.factor).toMatch(/speech/i);
    expect(top.points).toBeCloseTo(90.25, 1);
  });

  it('shows the vitals floor as its own factor, naming the vital', () => {
    // SpO2 91: loneliness 19.2 + 0.2 × fall 18.5 = 22.9 → floored to 40, so the floor adds 17.1
    const floor = evaluate(wear(91, 72)).explanation.factors.find(f => /flag/i.test(f.factor));
    expect(floor?.factor).toMatch(/blood oxygen/i);
    expect(floor?.points).toBeCloseTo(17.1, 1);
  });

  it('keeps factor names stable as a flagged vital moves (they gate LLM calls)', () => {
    const names = (spO2: number, hr: number) => evaluate(wear(spO2, hr)).explanation.factors.map(f => f.factor).sort();
    expect(names(90.5, 72)).toEqual(names(91, 72));
    expect(names(97, 118)).toEqual(names(97, 112));
  });

  it('builds the narrative from the real top contributors', () => {
    const narrative = evaluate({ speechDrift: 100 }).explanation.narrative;
    expect(narrative).toMatch(/speech clarity drift \(\+90\)/i);
  });

  it.each([
    [97, 105],
    [92.5, 72],
  ])('does not cite vitals that raise no flag (SpO2 %s / HR %s)', (spO2, hr) => {
    const factors = evaluate(wear(spO2, hr)).explanation.topFactors.map(f => f.factor);
    expect(factors.join(' ')).not.toMatch(/heart rate|blood oxygen/i);
  });

  it.each([
    [97, 115, /heart rate/i],
    [91, 72, /blood oxygen/i],
  ])('cites flagged vitals (SpO2 %s / HR %s)', (spO2, hr, pattern) => {
    const factors = evaluate(wear(spO2, hr)).explanation.topFactors.map(f => f.factor);
    expect(factors.join(' ')).toMatch(pattern);
  });

  it('does not cite staff load as a reason, since it no longer affects the decision', () => {
    const factors = evaluate({ staffLoad: 90 }).explanation.topFactors.map(f => f.factor);
    expect(factors.join(' ')).not.toMatch(/staff/i);
  });
});

describe('fall risk counts time up', () => {
  const at = (hour: number, patch: Partial<CurrentState>) => evaluate({ timeOfDay: hour, ...patch });

  it.each([
    [14, 20, 1], [3, 20, 0], [3, 25, 0], [3, 70, 1], [3, 90, 1],
  ] as const)('at %s:00 with restlessness %s she is up %s of the hour', (hour, restlessness, expected) => {
    expect(timeUp({ ...defaultState(), timeOfDay: hour, restlessness }, DEFAULT_BASELINE)).toBeCloseTo(expected, 6);
  });

  it('is partly up at the bed-exit threshold', () => {
    const up = timeUp({ ...defaultState(), timeOfDay: 3, restlessness: 55 }, DEFAULT_BASELINE);
    expect(up).toBeGreaterThan(0.5);
    expect(up).toBeLessThan(0.8);
  });

  it('scores a frail resident asleep at 03:00 lower than awake at 14:00', () => {
    const frail = { mobility: 30, restlessness: 20 };
    expect(at(3, frail).risks.fall).toBeLessThan(at(14, frail).risks.fall);
  });

  it('scores her up at 03:00 at least as high as in the day', () => {
    const up = { mobility: 30, restlessness: 80 };
    expect(at(3, up).risks.fall).toBeGreaterThanOrEqual(at(14, up).risks.fall);
  });

  it('cites "Up at night" only when she is out of bed', () => {
    const names = (r: number) => at(3, { restlessness: r, mobility: 40 }).explanation.factors.map(f => f.factor).join(' ');
    expect(names(20)).not.toMatch(/up at night/i);
    expect(names(80)).toMatch(/up at night/i);
  });
});
