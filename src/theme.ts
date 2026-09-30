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

/** The viewer's choice: fixed light, fixed dark, or follow the simulated clock. */
export type ThemePreference = 'light' | 'dark' | 'auto';

const THEME_KEY = 'aura_theme';

export function resolveTheme(pref: ThemePreference, hour: number, baseline: ResidentBaseline): Theme {
  if (pref === 'light') return 'day';
  if (pref === 'dark') return 'night';
  return themeFor(hour, baseline);
}

/** Stored choice, or light when there is none (or storage is unavailable). */
export function loadThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch { /* storage unavailable */ }
  return 'light';
}

export function saveThemePreference(pref: ThemePreference): void {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* storage unavailable */ }
}
