import type { TimelineEvent, UrgencyBand } from './types';

/** One row per kind of event the simulation reports, in display order. */
export const LANES = [
  { id: 'fall', label: 'Fall risk', match: 'Fall risk elevated' },
  { id: 'confusion', label: 'Confusion', match: 'Confusion signs' },
  { id: 'isolation', label: 'Isolation', match: 'Isolation noted' },
  { id: 'bed-exit', label: 'Bed exit', match: 'Bed exit detected' },
  { id: 'wandering', label: 'Wandering', match: 'Wandering pattern' },
  { id: 'vitals', label: 'Vitals', match: 'Vitals flag' },
  { id: 'acted', label: 'AURA acted', match: 'AURA acted' },
] as const;

export interface LaneCell {
  hour: number;
  severity: UrgencyBand | null;   // most severe event in this hour, if any
  events: TimelineEvent[];
}

export interface Lane {
  id: string;
  label: string;
  cells: LaneCell[];
}

const RANK: Record<UrgencyBand, number> = { Low: 1, Medium: 2, High: 3 };

export function eventLanes(events: TimelineEvent[]): Lane[] {
  return LANES.map(l => ({
    id: l.id,
    label: l.label,
    cells: Array.from({ length: 24 }, (_, hour) => {
      const here = events.filter(e => e.label === l.match && e.time === hour);
      const severity = here.reduce<UrgencyBand | null>(
        (worst, e) => (worst === null || RANK[e.urgency] > RANK[worst] ? e.urgency : worst), null);
      return { hour, severity, events: here };
    }),
  }));
}

/** One hour's events, most severe first. */
export function hourEvents(events: TimelineEvent[], hour: number): TimelineEvent[] {
  return events.filter(e => e.time === hour).sort((a, b) => RANK[b.urgency] - RANK[a.urgency]);
}
