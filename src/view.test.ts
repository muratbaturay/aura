import { describe, it, expect } from 'vitest';
import type { CurrentState, ExplanationFactor } from './types';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks, buildExplanation } from './risk';
import { haloView, scoreBarSegments } from './view';

const f = (factor: string, points: number): ExplanationFactor => ({ factor, points });

function explain(patch: Partial<CurrentState>) {
  const state = { ...defaultState(), ...patch };
  const devs = computeDeviations(DEFAULT_BASELINE, state);
  const risks = computeRisks(state, devs, DEFAULT_BASELINE);
  return { risks, explanation: buildExplanation(state, devs, risks, DEFAULT_BASELINE) };
}

describe('haloView', () => {
  it('breathes faster at every step up the ladder', () => {
    const periods = ([1, 2, 3, 4] as const).map(l => haloView(l).periodSec);
    for (let i = 1; i < periods.length; i++) expect(periods[i]).toBeLessThan(periods[i - 1]);
  });

  it('uses the colour token for its level', () => {
    expect(haloView(1).colorVar).toBe('--c-level-1');
    expect(haloView(4).colorVar).toBe('--c-level-4');
  });
});

describe('scoreBarSegments', () => {
  it('adds up to the Overall score for real explanations', () => {
    const cases: Partial<CurrentState>[] = [
      {},
      { speechDrift: 100 },
      { timeOfDay: 3, restlessness: 80, mobility: 30 },
      { mobility: 5, restlessness: 90 },
      { useWearables: true, spO2: 91, heartRate: 115 },
      { socialIsolation: 70, speechDrift: 60 },
    ];
    for (const c of cases) {
      const { risks, explanation } = explain(c);
      const total = scoreBarSegments(explanation.factors).reduce((sum, s) => sum + s.points, 0);
      expect(total).toBeCloseTo(risks.overall, 6);
    }
  });

  it('groups two or more small factors into "Other signals"', () => {
    const segs = scoreBarSegments([f('Speech', 60), f('Social', 8), f('Night', 1.5), f('Activity', 0.7)]);
    expect(segs.map(s => s.label)).toEqual(['Speech', 'Social', 'Other signals']);
    expect(segs[2].points).toBeCloseTo(2.2, 9);
  });

  it('keeps a single small factor under its own name', () => {
    const segs = scoreBarSegments([f('Speech', 60), f('Night', 1.5)]);
    expect(segs.map(s => s.label)).toEqual(['Speech', 'Night']);
  });

  it('shades the largest segment darkest and "Other signals" lightest', () => {
    const segs = scoreBarSegments([f('A', 40), f('B', 20), f('C', 10), f('D', 5), f('E', 3), f('F', 1), f('G', 1)]);
    expect(segs[0].shade).toBe(1);
    expect(segs.map(s => s.shade)).toEqual([...segs.map(s => s.shade)].sort((a, b) => a - b));
    expect(segs[segs.length - 1]).toMatchObject({ label: 'Other signals', shade: 5 });
  });

  it('never draws more than the 0–100 scale', () => {
    const segs = scoreBarSegments([f('A', 70), f('B', 45)]);
    expect(segs.reduce((sum, s) => sum + s.widthPct, 0)).toBeCloseTo(100, 9);
  });

  it('draws nothing when there are no factors', () => {
    expect(scoreBarSegments([])).toEqual([]);
  });
});
