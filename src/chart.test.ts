import { describe, it, expect } from 'vitest';
import { ELEANOR } from './residents';
import { defaultState } from './baseline';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { renderTimelineChart } from './chart';

describe('renderTimelineChart', () => {
  const box = { innerHTML: '' } as HTMLElement;
  renderTimelineChart(box, simulate24h(ELEANOR, defaultState(), { rng: createRng(1) }));

  it('writes legend labels in a text colour, not the pale series colour', () => {
    for (const label of ['Fall', 'Cognitive', 'Loneliness']) {
      expect(box.innerHTML).toMatch(new RegExp(`fill="var\\(--c-text[^"]*\\)">${label}<`));
    }
  });

  it('never draws a series in the lightest level colour', () => {
    expect(box.innerHTML).not.toContain('stroke="var(--c-level-1)"');
    expect(box.innerHTML).not.toContain('stroke="var(--c-level-2)"');
  });
});

describe('renderTimelineChart at the first hour', () => {
  it('draws no NaN coordinates when only one hour exists yet', () => {
    const box = { innerHTML: '' } as HTMLElement;
    renderTimelineChart(box, simulate24h(ELEANOR, defaultState(), { rng: createRng(1) }).slice(0, 1));
    expect(box.innerHTML).not.toContain('NaN');
  });
});
