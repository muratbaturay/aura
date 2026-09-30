import type { ResidentBaseline } from './types';
import { isNightHour } from './baseline';

export type Theme = 'day' | 'night';

/** The interface follows the resident's clock: night-safe colours while they sleep. */
export function themeFor(hour: number, baseline: ResidentBaseline): Theme {
  return isNightHour(hour, baseline) ? 'night' : 'day';
}

export function partOfDay(hour: number): 'Morning' | 'Afternoon' | 'Evening' | 'Night' {
  const h = Math.floor(((hour % 24) + 24) % 24);
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 22) return 'Evening';
  return 'Night';
}
