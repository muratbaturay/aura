import { describe, it, expect } from 'vitest';
import type { CurrentState } from './types';
import { RESIDENTS, residentById, usualStateAt, type Resident } from './residents';
import { assess } from './assessment';
import { selectIntervention } from './intervention';

const at = (r: Resident, hour: number, patch: Partial<CurrentState> = {}) =>
  assess({ ...usualStateAt(r, hour), ...patch }, r);
const walter = residentById('walter');
const margaret = residentById('margaret');
const joseph = residentById('joseph');
const eleanor = residentById('eleanor');

describe('assess: change from her own normal', () => {
  it('scores every resident at their usual level as no alert', () => {
    for (const r of RESIDENTS) {
      for (const h of [3, 10, 19]) {
        const a = at(r, h);
        expect(a.alert, `${r.id} ${h}:00`).toEqual({ fall: 0, cognitive: 0, loneliness: 0, overall: 0 });
        expect(selectIntervention({ ...usualStateAt(r, h) }, a.alert, 0, r).level).toBe(1);
      }
    }
  });

  it("alerts Eleanor at levels that are normal for Walter", () => {
    const eleanorAsWalter = at(eleanor, 14, {
      mobility: walter.usual.mobility, restlessness: walter.usual.restlessness,
      speechDrift: walter.usual.speechDrift, socialIsolation: walter.usual.socialIsolation,
    });
    expect(eleanorAsWalter.alert.fall).toBeGreaterThanOrEqual(30);
    expect(at(walter, 14).alert.fall).toBe(0);
  });

  it('alerts Walter only when he is less steady than his usual', () => {
    expect(at(walter, 14, { mobility: 42 }).alert.fall).toBe(0);
    expect(at(walter, 14, { mobility: 30 }).alert.fall).toBeGreaterThan(0);
  });

  it("treats Margaret's evening restlessness as her normal", () => {
    expect(at(margaret, 19).alert.overall).toBe(0);
    expect(at(margaret, 19, { restlessness: 70 }).alert.overall).toBeGreaterThan(0);
  });

  it("keeps Joseph's usual SpO2 quiet but flags a dip below 92", () => {
    expect(at(joseph, 11).alert.overall).toBe(0);
    expect(at(joseph, 11, { spO2: 91 }).alert.overall).toBeGreaterThanOrEqual(40);
  });

  it('escalates a resident who is up at night and very unsteady, whatever their normal', () => {
    const a = at(walter, 3, { restlessness: 85, mobility: 20 });
    expect(a.standing.fall).toBeGreaterThanOrEqual(85);
    expect(a.alert.overall).toBeGreaterThanOrEqual(70);
  });
});

describe('assess: nights', () => {
  it('treats Eleanor getting up at night as normal (a bed exit, not an alarm)', () => {
    const s = { ...usualStateAt(eleanor, 3), restlessness: 75 };
    expect(selectIntervention(s, assess(s, eleanor).alert, 0, eleanor).level).toBe(1);
  });

  it("raises a staff alert when Walter gets up at night (his care plan's bed-exit alert)", () => {
    const s = { ...usualStateAt(walter, 3), restlessness: 75 };
    const a = assess(s, walter);
    expect(selectIntervention(s, a.alert, 0, walter).level).toBeGreaterThanOrEqual(3);
    expect(a.explanation.factors[0].factor).toMatch(/bed-exit alert/i);
  });

  it('escalates anyone who is up at night and very unsteady', () => {
    const s = { ...usualStateAt(eleanor, 3), restlessness: 85, mobility: 10 };
    const a = assess(s, eleanor);
    expect(a.standing.fall).toBeGreaterThanOrEqual(85);
    expect(a.alert.overall).toBeGreaterThanOrEqual(70);
  });
});

describe('assess: daytime sensitivity', () => {
  it("notices a 30-point drop in Eleanor's steadiness", () => {
    expect(at(eleanor, 14, { mobility: 40 }).alert.fall).toBeGreaterThanOrEqual(40);
  });
});

describe('assess: explanation', () => {
  it('attributes exactly the overall alert, with only positive factors', () => {
    const cases: [Resident, number, Partial<CurrentState>][] = [
      [eleanor, 14, {}], [eleanor, 14, { speechDrift: 90, mobility: 80 }],
      [eleanor, 3, { restlessness: 80, mobility: 30 }], [walter, 14, { mobility: 25, socialIsolation: 20 }],
      [walter, 2, { restlessness: 85, mobility: 20 }], [margaret, 19, { speechDrift: 85, restlessness: 20 }],
      [margaret, 10, { socialIsolation: 80 }], [joseph, 11, { spO2: 89 }], [joseph, 15, { socialIsolation: 95, mobility: 40 }],
      [joseph, 23, { restlessness: 70, heartRate: 118 }], [walter, 14, { mobility: 0, restlessness: 100, speechDrift: 100 }],
    ];
    for (const [r, h, patch] of cases) {
      const a = at(r, h, patch);
      const sum = a.explanation.factors.reduce((s, f) => s + f.points, 0);
      expect(sum, `${r.id} ${h}`).toBeCloseTo(a.alert.overall, 6);
      for (const f of a.explanation.factors) expect(f.points).toBeGreaterThan(0);
    }
  });

  it("says the changes are above the resident's usual", () => {
    expect(at(margaret, 19, { speechDrift: 90 }).explanation.narrative).toMatch(/above Margaret's usual/);
    expect(at(joseph, 11).explanation.narrative).toMatch(/Joseph is close to usual/);
  });
});

describe('messages', () => {
  it("uses the resident's own contact in a loneliness prompt", () => {
    // Withdrawal is Joseph's normal: it takes more isolation *and* less activity to alert
    const patch = { socialIsolation: 85, mobility: 50, restlessness: 15 };
    const a = at(joseph, 14, patch);
    const out = selectIntervention({ ...usualStateAt(joseph, 14), ...patch }, a.alert, 0, joseph);
    expect(out.level).toBe(2);
    const msg = out.residentMessage;
    expect(msg).toMatch(/friend Samuel/);
  });

  it('never prints a score as a percentage', () => {
    const s = { ...usualStateAt(walter, 3), restlessness: 85, mobility: 20 };
    const out = selectIntervention(s, assess(s, walter).alert, 3, walter);
    expect(out.staffMessage).not.toMatch(/\d%/);
  });
});
