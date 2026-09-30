import type {
  ResidentBaseline, CurrentState, Deviations, RiskScores, UrgencyBand, VitalsFlag,
  RiskDomain, RiskSignal, RiskTerm, ExplanationFactor, ExplanationOutput,
} from './types';
import { isNightHour } from './baseline';

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export const RISK_DOMAINS: RiskDomain[] = ['fall', 'cognitive', 'loneliness'];

/** Weight of the second-worst domain in the overall score. */
export const SECOND_DOMAIN_WEIGHT = 0.2;

/** Minimum overall score while a vitals flag is raised. */
export const VITALS_FLOOR: Record<VitalsFlag, number> = { none: 0, amber: 40, red: 70 };

/**
 * Additive parts of each domain score (before clamping), tagged with the
 * signal they come from. computeRisks sums these and buildExplanation
 * attributes them, so the explanation cannot drift from the score.
 */
/** Share of fall vulnerability that remains while asleep in bed. */
export const ASLEEP_SHARE = 0.35;

/** Time up at night: restlessness at or below FROM is asleep, FROM + SPAN or above is a full hour up. */
export const TIME_UP = { from: 25, span: 45 };

/** Every weight in the standing-risk formulas (illustrative, not fitted to outcomes). */
export const WEIGHTS = {
  fall: {
    unsteadiness: 0.35,        // × (100 − mobility)
    lessSteadyThanBaseline: 5, // × z-score below her baseline mobility
    restlessness: 0.2,
    moreRestlessThanBaseline: 3,
    upAtNight: 18,             // × time up at night
    heartRateFrom: 110, heartRate: 0.5, // × beats above
    spo2From: 92, spo2: 3,              // × points below
  },
  cognitive: {
    speechDrift: 0.45,
    moreDriftThanBaseline: 4,
    nightRestlessness: 0.25,   // night wandering proxy
  },
  loneliness: {
    isolation: 0.5,
    moreIsolatedThanBaseline: 4,
    lowActivity: 0.3,          // × max(0, activityFloor − activity)
    activityFloor: 50,
    activityMobility: 0.3,     // activity = 0.3 × mobility + 0.2 × (100 − restlessness)
    activityCalm: 0.2,
  },
} as const;

/** Urgency bands for any 0–100 score. */
export const BANDS = { medium: 40, high: 70 } as const;

/**
 * Share of the hour she is out of bed, 0–1. Awake hours count as up; at night it
 * follows restlessness: calm sleep (≤ 25) is 0, the bed-exit level (55) about
 * two thirds, and 70 or more a full hour up.
 */
export function timeUp(state: CurrentState, baseline: ResidentBaseline): number {
  if (!isNightHour(state.timeOfDay, baseline)) return 1;
  return Math.max(0, Math.min(1, (state.restlessness - TIME_UP.from) / TIME_UP.span));
}

export function riskTerms(
  state: CurrentState,
  deviations: Deviations,
  baseline: ResidentBaseline
): Record<RiskDomain, RiskTerm[]> {
  const night = isNightHour(state.timeOfDay, baseline);

  // ── Fall Risk ──
  // Vulnerability counts in full while she is up; asleep in bed a third remains
  // (falls from bed are real). Being up at night adds its own risk.
  const up = timeUp(state, baseline);
  const exposure = ASLEEP_SHARE + (1 - ASLEEP_SHARE) * up;
  const F = WEIGHTS.fall;
  const fall: RiskTerm[] = [
    // Lower mobility stability → higher risk, amplified below personal baseline
    { signal: 'mobility', points: exposure * ((100 - state.mobility) * F.unsteadiness + Math.max(0, deviations.mobility) * F.lessSteadyThanBaseline) },
    // Higher restlessness → higher risk, amplified above personal baseline
    { signal: 'restlessness', points: exposure * (state.restlessness * F.restlessness + Math.max(0, deviations.restlessness) * F.moreRestlessThanBaseline) },
    // Out of bed at night (dark, drowsy)
    { signal: 'night', points: night ? F.upAtNight * up : 0 },
  ];
  // Vitals influence
  if (state.useWearables) {
    fall.push({ signal: 'heartRate', points: exposure * Math.max(0, state.heartRate - F.heartRateFrom) * F.heartRate });
    fall.push({ signal: 'spO2', points: exposure * Math.max(0, F.spo2From - state.spO2) * F.spo2 });
  }

  // ── Cognitive Concern Signal ──
  const C = WEIGHTS.cognitive;
  const cognitive: RiskTerm[] = [
    { signal: 'speech', points: state.speechDrift * C.speechDrift + Math.max(0, deviations.speech) * C.moreDriftThanBaseline },
    // Night wandering proxy
    { signal: 'restlessness', points: night ? state.restlessness * C.nightRestlessness : 0 },
  ];

  // ── Loneliness Risk ──
  // Low movement + high isolation
  const L = WEIGHTS.loneliness;
  const activityProxy = state.mobility * L.activityMobility + (100 - state.restlessness) * L.activityCalm;
  const loneliness: RiskTerm[] = [
    { signal: 'social', points: state.socialIsolation * L.isolation + Math.max(0, deviations.social) * L.moreIsolatedThanBaseline },
    { signal: 'activity', points: Math.max(0, L.activityFloor - activityProxy) * L.lowActivity },
  ];

  return { fall, cognitive, loneliness };
}

function sumTerms(terms: RiskTerm[]): number {
  return terms.reduce((sum, t) => sum + t.points, 0);
}

/** Domains ordered worst first (ties keep RISK_DOMAINS order). */
export function rankDomains(scores: Record<RiskDomain, number>): RiskDomain[] {
  return [...RISK_DOMAINS].sort((a, b) => scores[b] - scores[a]);
}

export function computeRisks(
  state: CurrentState,
  deviations: Deviations,
  baseline: ResidentBaseline
): RiskScores {
  const terms = riskTerms(state, deviations, baseline);
  const fall = clamp(sumTerms(terms.fall));
  const cognitive = clamp(sumTerms(terms.cognitive));
  const loneliness = clamp(sumTerms(terms.loneliness));

  // ── Overall Urgency ──
  // Worst domain, nudged up when a second domain is also elevated — a single
  // severe concern is never diluted by calm signals elsewhere.
  const scores = { fall, cognitive, loneliness };
  const [worst, second] = rankDomains(scores);
  // Vitals floor keeps the overall card consistent with vitals-driven escalation
  const overall = clamp(Math.max(
    scores[worst] + scores[second] * SECOND_DOMAIN_WEIGHT,
    VITALS_FLOOR[vitalsFlag(state)],
  ));

  return { fall, cognitive, loneliness, overall };
}

/** Vitals targets from the care plan: amber below/above the first pair, red beyond the second. */
export interface VitalsTargets {
  spo2Amber: number;  // amber when SpO2 is below this
  spo2Red: number;    // red when SpO2 is below this
  hrAmber: number;    // amber when heart rate is above this
  hrRed: number;      // red when heart rate is above this
}

export const DEFAULT_VITALS: VitalsTargets = { spo2Amber: 92, spo2Red: 90, hrAmber: 110, hrRed: 120 };

/** Wearable red flags: red always escalates, amber warrants a staff check. */
export function vitalsFlag(state: CurrentState, t: VitalsTargets = DEFAULT_VITALS): VitalsFlag {
  if (!state.useWearables) return 'none';
  if (state.spO2 < t.spo2Red || state.heartRate > t.hrRed) return 'red';
  if (state.spO2 < t.spo2Amber || state.heartRate > t.hrAmber) return 'amber';
  return 'none';
}

export function urgencyBand(score: number): UrgencyBand {
  if (score < BANDS.medium) return 'Low';
  if (score < BANDS.high) return 'Medium';
  return 'High';
}

const SIGNAL_LABELS: Record<RiskSignal, string> = {
  mobility: 'Mobility stability',
  restlessness: 'Restlessness',
  speech: 'Speech clarity drift',
  social: 'Social isolation',
  night: 'Up at night',
  activity: 'Low overall activity',
  heartRate: 'Heart rate',
  spO2: 'Blood oxygen (SpO2)',
};

// No live readings in the label: factor names feed the LLM change-detection
// signature, and the trigger line already shows the values.
export function vitalsFlagLabel(state: CurrentState, flag: VitalsFlag, t: VitalsTargets = DEFAULT_VITALS): string {
  const parts: string[] = [];
  if (state.spO2 < t.spo2Amber) parts.push('blood oxygen');
  if (state.heartRate > t.hrAmber) parts.push('heart rate');
  return `Vitals ${flag} flag: ${parts.join(' and ')}`;
}

/**
 * Attributes the Overall score to the signals behind it, following
 * computeRisks exactly: the worst domain's parts count in full, the
 * second-worst's at SECOND_DOMAIN_WEIGHT, a capped domain's parts are scaled
 * to its capped score, and a vitals floor appears as its own factor.
 * Factor points always sum to risks.overall.
 */
/**
 * Each domain's score split by signal label, scaled so a capped domain's parts
 * add up to its capped score (the same attribution buildExplanation uses).
 */
export function domainContributions(
  state: CurrentState,
  deviations: Deviations,
  baseline: ResidentBaseline,
  risks: RiskScores,
): Record<RiskDomain, Map<string, number>> {
  const terms = riskTerms(state, deviations, baseline);
  const out = {} as Record<RiskDomain, Map<string, number>>;
  for (const d of RISK_DOMAINS) {
    const raw = sumTerms(terms[d]);
    const capScale = raw > 0 ? risks[d] / raw : 0;
    const m = new Map<string, number>();
    for (const t of terms[d]) {
      const label = SIGNAL_LABELS[t.signal];
      m.set(label, (m.get(label) ?? 0) + t.points * capScale);
    }
    out[d] = m;
  }
  return out;
}

export function buildExplanation(
  state: CurrentState,
  deviations: Deviations,
  risks: RiskScores,
  baseline: ResidentBaseline
): ExplanationOutput {
  const terms = riskTerms(state, deviations, baseline);
  const [worst, second] = rankDomains(risks);

  const points = new Map<string, number>();
  const add = (label: string, p: number) => {
    if (p > 0) points.set(label, (points.get(label) ?? 0) + p);
  };

  for (const [domain, weight] of [[worst, 1], [second, SECOND_DOMAIN_WEIGHT]] as const) {
    const raw = sumTerms(terms[domain]);
    const capScale = raw > 0 ? risks[domain] / raw : 0;
    for (const t of terms[domain]) add(SIGNAL_LABELS[t.signal], t.points * capScale * weight);
  }

  const combined = risks[worst] + risks[second] * SECOND_DOMAIN_WEIGHT;
  const flag = vitalsFlag(state);
  const floor = VITALS_FLOOR[flag];
  if (floor > combined) add(vitalsFlagLabel(state, flag), floor - combined);

  // Overall is capped at 100; scale so the factors still sum to it
  const total = Math.max(combined, floor);
  const overallScale = total > 0 ? risks.overall / total : 0;

  const factors: ExplanationFactor[] = [...points]
    .map(([factor, p]) => ({ factor, points: p * overallScale }))
    .sort((a, b) => b.points - a.points);
  const topFactors = factors.slice(0, 3);

  // Build narrative
  const score = Math.round(risks.overall);
  const lead = topFactors.slice(0, 2)
    .map(f => `${f.factor[0].toLowerCase()}${f.factor.slice(1)} (+${Math.round(f.points)})`)
    .join(' and ');
  let narrative: string;
  switch (urgencyBand(risks.overall)) {
    case 'Low':
      narrative = `Overall urgency is low (${score}/100).` +
        (lead ? ` The largest contributors are ${lead}.` : '');
      break;
    case 'Medium':
      narrative = `Overall urgency is moderate (${score}/100), driven mainly by ${lead}. ` +
        `These patterns are being monitored to ensure the resident's comfort and safety.`;
      break;
    case 'High':
      narrative = `Overall urgency is high (${score}/100), driven mainly by ${lead}. ` +
        `Timely support is recommended to ensure the resident's wellbeing.`;
      break;
  }

  return { factors, topFactors, narrative };
}
