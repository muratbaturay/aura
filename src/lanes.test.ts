import { describe, it, expect } from 'vitest';
import type { TimelineEvent } from './types';
import { DEFAULT_BASELINE, defaultState } from './baseline';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { SCENARIOS } from './scenarios';
import { LANES, eventLanes, hourEvents } from './lanes';

const ev = (time: number, label: string, urgency: TimelineEvent['urgency'], detail = ''): TimelineEvent =>
  ({ time, label, urgency, detail });

describe('eventLanes', () => {
  it('always has the same lanes, each with 24 hourly cells', () => {
    const lanes = eventLanes([]);
    expect(lanes.map(l => l.label)).toEqual(['Bed exit', 'Fall risk', 'Wandering', 'Isolation', 'Blood oxygen', 'Calm period']);
    for (const lane of lanes) {
      expect(lane.cells.map(c => c.hour)).toEqual(Array.from({ length: 24 }, (_, h) => h));
      expect(lane.cells.every(c => c.severity === null)).toBe(true);
    }
  });

  it('puts an event in its lane and hour, keeping the most severe in a shared cell', () => {
    const lanes = eventLanes([
      ev(4, 'Bed exit detected', 'Medium'),
      ev(4, 'Bed exit detected', 'High'),
      ev(9, 'Comfortable period', 'Low'),
    ]);
    const bed = lanes.find(l => l.label === 'Bed exit')!;
    expect(bed.cells[4].severity).toBe('High');
    expect(bed.cells[4].events).toHaveLength(2);
    expect(bed.cells[5].severity).toBeNull();
    expect(lanes.find(l => l.label === 'Calm period')!.cells[9].severity).toBe('Low');
  });

  it('has a lane for every event the simulation can produce', () => {
    const labels = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const useWearables of [false, true]) {
        const snaps = simulate24h(DEFAULT_BASELINE, { ...defaultState(), useWearables }, { rng: createRng(seed) });
        snaps.forEach(s => s.events.forEach(e => labels.add(e.label)));
      }
    }
    for (const sc of SCENARIOS) {
      simulate24h(DEFAULT_BASELINE, defaultState(), { rng: createRng(sc.seed), scenario: sc })
        .forEach(s => s.events.forEach(e => labels.add(e.label)));
    }
    const covered = new Set<string>(LANES.map(l => l.match));
    for (const label of labels) expect(covered.has(label), label).toBe(true);
  });
});

describe('hourEvents', () => {
  it("lists one hour's events, most severe first", () => {
    const events = [ev(5, 'Bed exit detected', 'Medium'), ev(5, 'Fall risk elevated', 'High'), ev(6, 'Comfortable period', 'Low')];
    expect(hourEvents(events, 5).map(e => e.label)).toEqual(['Fall risk elevated', 'Bed exit detected']);
    expect(hourEvents(events, 7)).toEqual([]);
  });
});
