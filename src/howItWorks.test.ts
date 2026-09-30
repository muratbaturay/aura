import { describe, it, expect } from 'vitest';
import doc from '../docs/how-it-works.md?raw';
import { formulaLines, ladderLines, redFlagLines, residentRows } from './howItWorks';
import { ALERT_GAIN, MIN_HEADROOM, UNSTEADY_UP_FALL } from './assessment';
import { ASLEEP_SHARE, SECOND_DOMAIN_WEIGHT, WEIGHTS, BANDS } from './risk';

describe('how it works: content', () => {
  it('builds the formulas from the live constants', () => {
    const text = formulaLines().join('\n');
    expect(text).toContain(`${ALERT_GAIN} × 100 × (now − usual) ÷ max(${MIN_HEADROOM}, 100 − usual)`);
    expect(text).toContain(`${ASLEEP_SHARE} + ${1 - ASLEEP_SHARE} × time up`);
    expect(text).toContain(`${WEIGHTS.fall.unsteadiness} × (100 − mobility)`);
    expect(text).toContain(`worst area + ${SECOND_DOMAIN_WEIGHT} × second-worst`);
    expect(text).toContain(`Low < ${BANDS.medium} ≤ Medium < ${BANDS.high} ≤ High`);
  });

  it('states the red flags with their live thresholds', () => {
    expect(redFlagLines().join('\n')).toContain(`fall risk ≥ ${UNSTEADY_UP_FALL}`);
  });

  it("lists each resident's care-plan targets", () => {
    const joseph = residentRows().find(r => r.name === 'Joseph')!;
    expect(joseph.vitals).toBe('SpO2 amber < 88, red < 85');
    expect(residentRows().find(r => r.name === 'Walter')!.bedExitAlert).toBe('yes');
  });
});

describe('how it works: the GitHub doc matches the code', () => {
  for (const [name, lines] of [['formula', formulaLines()], ['ladder', ladderLines()], ['red flag', redFlagLines()]] as const) {
    it(`contains every ${name} line exactly`, () => {
      for (const line of lines) expect(doc, line).toContain(line);
    });
  }

  it("contains each resident's targets", () => {
    for (const r of residentRows()) expect(doc, r.name).toContain(`| ${r.name}, ${r.age} |`);
  });
});
