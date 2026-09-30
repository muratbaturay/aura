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
const ASLEEP_SHARE = 0.35;

/**
 * Share of the hour she is out of bed, 0–1. Awake hours count as up; at night it
 * follows restlessness: calm sleep (≤ 25) is 0, the bed-exit level (55) about
 * two thirds, and 70 or more a full hour up.
 */
export function timeUp(state: CurrentState, baseline: ResidentBaseline): number {
  if (!isNightHour(state.timeOfDay, baseline)) return 1;
  return Math.max(0, Math.min(1, (state.restlessness - 25) / 45));
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
  const fall: RiskTerm[] = [
    // Lower mobility stability → higher risk, amplified below personal baseline
    { signal: 'mobility', points: exposure * ((100 - state.mobility) * 0.35 + Math.max(0, deviations.mobility) * 5) },
    // Higher restlessness → higher risk, amplified above personal baseline
    { signal: 'restlessness', points: exposure * (state.restlessness * 0.20 + Math.max(0, deviations.restlessness) * 3) },
    // Out of bed at night (dark, drowsy)
    { signal: 'night', points: night ? 18 * up : 0 },
  ];
  // Vitals influence
  if (state.useWearables) {
    fall.push({ signal: 'heartRate', points: exposure * Math.max(0, state.heartRate - 110) * 0.5 });
    fall.push({ signal: 'spO2', points: exposure * Math.max(0, 92 - state.spO2) * 3 });
  }

  // ── Cognitive Concern Signal ──
  const cognitive: RiskTerm[] = [
    { signal: 'speech', points: state.speechDrift * 0.45 + Math.max(0, deviations.speech) * 4 },
    // Night wandering proxy
    { signal: 'restlessness', points: night ? state.restlessness * 0.25 : 0 },
  ];

  // ── Loneliness Risk ──
  // Low movement + high isolation
  const activityProxy = state.mobility * 0.3 + (100 - state.restlessness) * 0.2;
  const loneliness: RiskTerm[] = [
    { signal: 'social', points: state.socialIsolation * 0.50 + Math.max(0, deviations.social) * 4 },
    { signal: 'activity', points: Math.max(0, 50 - activityProxy) * 0.3 },
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

/** Wearable red flags: red always escalates, amber warrants a staff check. */
export function vitalsFlag(state: CurrentState): VitalsFlag {
  if (!state.useWearables) return 'none';
  if (state.spO2 < 90 || state.heartRate > 120) return 'red';
  if (state.spO2 < 92 || state.heartRate > 110) return 'amber';
  return 'none';
}

export function urgencyBand(score: number): UrgencyBand {
  if (score < 40) return 'Low';
  if (score < 70) return 'Medium';
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
export function vitalsFlagLabel(state: CurrentState, flag: VitalsFlag): string {
  const parts: string[] = [];
  if (state.spO2 < 92) parts.push('blood oxygen');
  if (state.heartRate > 110) parts.push('heart rate');
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
