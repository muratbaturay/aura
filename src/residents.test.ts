import { describe, it, expect } from 'vitest';
import { RESIDENTS, residentById, usualStateAt, ELEANOR } from './residents';

describe('residents', () => {
  it('has the four residents in order', () => {
    expect(RESIDENTS.map(r => r.id)).toEqual(['eleanor', 'walter', 'margaret', 'joseph']);
    expect(residentById('walter').name).toBe('Walter');
    expect(ELEANOR.id).toBe('eleanor');
  });

  it("keeps each baseline's means equal to the resident's usual levels", () => {
    for (const r of RESIDENTS) {
      expect(r.baseline.mobilityMean, r.id).toBe(r.usual.mobility);
      expect(r.baseline.restlessnessMean, r.id).toBe(r.usual.restlessness);
      expect(r.baseline.speechMean, r.id).toBe(r.usual.speechDrift);
      expect(r.baseline.socialMean, r.id).toBe(r.usual.socialIsolation);
    }
  });

  it('gives Joseph wearables with a lower usual SpO2', () => {
    const j = residentById('joseph');
    expect(j.usual.useWearables).toBe(true);
    expect(j.usual.heartRate).toBe(84);
    expect(j.usual.spO2).toBe(93);
  });
});

describe('usualStateAt', () => {
  it('is the usual levels by day, at that hour', () => {
    const s = usualStateAt(residentById('walter'), 14);
    expect(s).toMatchObject({ timeOfDay: 14, mobility: 42, restlessness: 35, speechDrift: 22, socialIsolation: 35 });
  });

  it("adds Margaret's evening restlessness from 17:00 to 21:59 only", () => {
    const m = residentById('margaret');
    expect(usualStateAt(m, 16).restlessness).toBe(32);
    expect(usualStateAt(m, 17).restlessness).toBe(42);
    expect(usualStateAt(m, 21).restlessness).toBe(42);
    expect(usualStateAt(m, 22).restlessness).toBe(15);
  });

  it('is asleep at night: restlessness 15, other signals usual', () => {
    for (const r of RESIDENTS) {
      const s = usualStateAt(r, 3);
      expect(s.restlessness, r.id).toBe(15);
      expect(s.mobility, r.id).toBe(r.usual.mobility);
    }
  });
});
