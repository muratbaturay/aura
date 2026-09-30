import type { InterventionLevel, ResidentBaseline } from './types';
import { isNightHour } from './baseline';

export interface RingSegment {
  hour: number;
  fill: InterventionLevel | 'future';
  isNow: boolean;
  isNight: boolean;
}

const SLICE_DEG = 15; // 24 hours around the dial
const GAP_DEG = 1;    // gap on each side of a slice

/** One segment per hour: its intervention level if known, else "future". */
export function ringSegments(
  levels: (InterventionLevel | null)[],
  nowHour: number,
  baseline: ResidentBaseline
): RingSegment[] {
  const now = Math.floor(nowHour);
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    fill: levels[hour] ?? 'future',
    isNow: hour === now,
    isNight: isNightHour(hour, baseline),
  }));
}

/** conic-gradient drawing the hour slices, 00 at the top, clockwise. */
export function ringGradient(segments: RingSegment[]): string {
  const stops = segments.flatMap(s => {
    const a = s.hour * SLICE_DEG, b = a + SLICE_DEG;
    const colour = s.fill === 'future' ? 'var(--ring-future)' : `var(--c-level-${s.fill})`;
    return [
      `var(--ring-gap) ${a}deg ${a + GAP_DEG}deg`,
      `${colour} ${a + GAP_DEG}deg ${b - GAP_DEG}deg`,
      `var(--ring-gap) ${b - GAP_DEG}deg ${b}deg`,
    ];
  });
  return `conic-gradient(${stops.join(', ')})`;
}

/** conic-gradient for the thin outer arc that marks the night hours. */
export function nightArcGradient(segments: RingSegment[]): string {
  const stops = segments.map(s => {
    const a = s.hour * SLICE_DEG;
    return `${s.isNight ? 'var(--ring-night)' : 'transparent'} ${a}deg ${a + SLICE_DEG}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

/** Point on a circle for a (fractional) hour, 00 at the top, clockwise. */
export function ringPoint(hour: number, radius: number, center: number): { x: number; y: number } {
  const rad = (hour * SLICE_DEG * Math.PI) / 180;
  return { x: center + radius * Math.sin(rad), y: center - radius * Math.cos(rad) };
}
