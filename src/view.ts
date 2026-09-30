import type { InterventionLevel, ExplanationFactor } from './types';

// ── Halo ────────────────────────────────────────────────────

/** Breathing period per intervention level: calmer states breathe slower. */
const HALO_PERIOD_SEC: Record<InterventionLevel, number> = { 1: 8, 2: 6, 3: 4, 4: 2.4 };

export interface HaloView {
  colorVar: string;   // CSS custom property holding the level colour
  periodSec: number;  // one full breath
}

export function haloView(level: InterventionLevel): HaloView {
  return { colorVar: `--c-level-${level}`, periodSec: HALO_PERIOD_SEC[level] };
}

// ── Score bar ───────────────────────────────────────────────

/** Factors below this many points are grouped when there are two or more of them. */
const MIN_SEGMENT_POINTS = 2;
const OTHER_LABEL = 'Other signals';
const DARKEST_NAMED_SHADES = 4;

export interface ScoreSegment {
  label: string;
  points: number;     // contribution to the Overall score
  widthPct: number;   // width on the 0–100 bar
  shade: number;      // 1 = darkest … 4 for named factors, 5 for "Other signals"
}

/**
 * One segment per factor, largest first, so the bar's segments add up to the
 * Overall score. Several slivers under MIN_SEGMENT_POINTS merge into one
 * "Other signals" segment; a lone small factor keeps its name.
 */
export function scoreBarSegments(factors: ExplanationFactor[]): ScoreSegment[] {
  const sorted = [...factors].sort((a, b) => b.points - a.points);
  const small = sorted.filter(f => f.points < MIN_SEGMENT_POINTS);
  const named = small.length >= 2 ? sorted.filter(f => f.points >= MIN_SEGMENT_POINTS) : sorted;

  const segments = named.map((f, i) => ({
    label: f.factor,
    points: f.points,
    shade: Math.min(i + 1, DARKEST_NAMED_SHADES),
  }));
  if (small.length >= 2) {
    segments.push({ label: OTHER_LABEL, points: small.reduce((sum, f) => sum + f.points, 0), shade: 5 });
  }

  const total = segments.reduce((sum, s) => sum + s.points, 0);
  const scale = total > 100 ? 100 / total : 1;
  return segments.map(s => ({ ...s, widthPct: s.points * scale }));
}
