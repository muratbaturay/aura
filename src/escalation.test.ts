import { describe, it, expect } from 'vitest';
import type { CurrentState } from './types';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks, urgencyBand, vitalsFlag, buildExplanation } from './risk';
import { selectIntervention } from './intervention';

// Default state: 14:00, all signals at baseline, staff load 40, wearables off.
function evaluate(patch: Partial<CurrentState>, recentHighCount = 0) {
  const state = { ...defaultState(), ...patch };
  const devs = computeDeviations(DEFAULT_BASELINE, state);
  const risks = computeRisks(state, devs, DEFAULT_BASELINE);
  const intervention = selectIntervention(state, risks, recentHighCount);
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

  it('gives Level 4 after 3 consecutive High hours', () => {
    expect(evaluate({ speechDrift: 100 }, 3).intervention.level).toBe(4);
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

  it('does not quote a Low current score as a sustained pattern in the repeated-high escalation', () => {
    // Baseline overall is ≈22 (Low); the escalation comes from the recent-hours counter.
    const msg = evaluate({}, 3).intervention.staffMessage!;
    expect(msg).not.toMatch(/22%/);
    expect(msg).toMatch(/High/);
  });
});

describe('explanation', () => {
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
