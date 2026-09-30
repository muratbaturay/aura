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

  it("keeps Joseph's usual SpO2 quiet but flags a dip below his target of 88", () => {
    expect(at(joseph, 11).alert.overall).toBe(0);
    expect(at(joseph, 11, { spO2: 87 }).alert.overall).toBeGreaterThanOrEqual(40);
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

describe('final review fixes: scores in words', () => {
  it('labels the night fall reference as her usual when up', () => {
    const up = at(eleanor, 3, { restlessness: 75 });
    expect(up.fallReference).toBe('usual when up');
    expect(at(eleanor, 3).fallReference).toBe('usual');
    expect(at(eleanor, 14).fallReference).toBe('usual');
  });

  it('quotes risk with its usual in staff messages, not the change score', () => {
    const patch = { socialIsolation: 95, mobility: 30 };
    const s = { ...usualStateAt(joseph, 14), ...patch };
    const a = assess(s, joseph);
    const msg = selectIntervention(s, a.alert, 0, joseph, a).staffMessage!;
    expect(msg).toContain(`${Math.round(a.standing.loneliness)} (usual ${Math.round(a.usual.loneliness)})`);
    expect(msg).not.toContain(`(${Math.round(a.alert.loneliness)})`);
  });

  it('prints staff load as an index, not a percentage', () => {
    const s = { ...usualStateAt(walter, 3), restlessness: 75, staffLoad: 82 }; // up at night: Level 3
    const a = assess(s, walter);
    const msg = selectIntervention(s, a.alert, 0, walter, a).staffMessage!;
    expect(msg).toMatch(/staff load high \(82\/100\)/i);
    expect(msg).not.toMatch(/\d%/);
  });
});

describe('model refinements', () => {
  it('does not blow a small change up just because her usual is already high (headroom floor 50)', () => {
    // Walter up at night: his usual when up is ~70; 15 points less steady used to read 64
    const a = at(walter, 3, { restlessness: 85, mobility: walter.usual.mobility - 15 });
    expect(a.alert.fall).toBeLessThan(50);
    for (const r of RESIDENTS) {
      const b = at(r, 3, { restlessness: 85, mobility: r.usual.mobility - 25 });
      expect(b.alert.fall, r.id).toBeLessThan(70);
    }
  });

  it('escalates hours in a row out of bed at night, even without a bed-exit alert', () => {
    const up = { ...usualStateAt(eleanor, 3), restlessness: 75 };
    const level = (hoursUp: number) => {
      const a = assess(up, eleanor, { hoursUp });
      return selectIntervention(up, a.alert, 0, eleanor).level;
    };
    expect(level(1)).toBe(1);
    expect(level(2)).toBeGreaterThanOrEqual(2);
    expect(level(3)).toBeGreaterThanOrEqual(3);
    expect(assess(up, eleanor, { hoursUp: 3 }).explanation.factors[0].factor).toMatch(/up at night for 3 hours/i);
  });

  it("uses Joseph's own oxygen targets (COPD): amber below 88, red below 85", () => {
    const lvl = (spO2: number) => {
      const s = { ...usualStateAt(joseph, 11), spO2 };
      return selectIntervention(s, assess(s, joseph).alert, 0, joseph).level;
    };
    expect(lvl(90)).toBe(1);
    expect(lvl(87)).toBe(3);
    expect(lvl(84)).toBe(4);
    // Everyone else keeps the default targets
    const e = { ...usualStateAt(eleanor, 11), useWearables: true, spO2: 91 };
    expect(selectIntervention(e, assess(e, eleanor).alert, 0, eleanor).level).toBe(3);
  });
});
