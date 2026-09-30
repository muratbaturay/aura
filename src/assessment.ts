import type { CurrentState, RiskScores, RiskDomain, ExplanationFactor, ExplanationOutput } from './types';
import { computeDeviations, isNightHour } from './baseline';
import {
  computeRisks, domainContributions, rankDomains, timeUp, urgencyBand, vitalsFlag, vitalsFlagLabel,
  RISK_DOMAINS, SECOND_DOMAIN_WEIGHT, VITALS_FLOOR,
} from './risk';
import { usualStateAt, type Resident } from './residents';

export interface Assessment {
  standing: RiskScores;         // absolute risk now (how risky she is)
  usual: RiskScores;            // absolute risk at her usual state for this hour
  alert: RiskScores;            // change from her usual: what drives the ladder
  explanation: ExplanationOutput;
}

/** Standing fall risk at or above this while up at night escalates whatever her normal. */
const UNSTEADY_UP_FALL = 85;
const UNSTEADY_UP_FLOOR = 70;
const UNSTEADY_UP_LABEL = 'Up at night, very unsteady';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Compare her state now with her usual state at the same hour. Each domain's
 * alert is the rise above usual as a share of the headroom left
 * (100 × (now − usual) / (100 − usual)); the overall alert combines domains as
 * the standing score does, with absolute red flags as floors.
 */
export function assess(state: CurrentState, resident: Resident): Assessment {
  const { baseline } = resident;
  const devs = computeDeviations(baseline, state);
  const standing = computeRisks(state, devs, baseline);
  const usualState = usualStateAt(resident, state.timeOfDay);
  const usualDevs = computeDeviations(baseline, usualState);
  const usual = computeRisks(usualState, usualDevs, baseline);

  const nowParts = domainContributions(state, devs, baseline, standing);
  const usualParts = domainContributions(usualState, usualDevs, baseline, usual);

  const alert = { fall: 0, cognitive: 0, loneliness: 0, overall: 0 };
  const parts = {} as Record<RiskDomain, Map<string, number>>;
  for (const d of RISK_DOMAINS) {
    const excess = standing[d] - usual[d];
    const headroom = Math.max(1, 100 - usual[d]);
    parts[d] = new Map();
    if (excess <= 0) continue;
    alert[d] = clamp((100 * excess) / headroom);
    // Only what rose is shown; scaled so the parts add up to this domain's alert
    const rises = [...new Set([...nowParts[d].keys(), ...usualParts[d].keys()])]
      .map(label => [label, (nowParts[d].get(label) ?? 0) - (usualParts[d].get(label) ?? 0)] as const)
      .filter(([, diff]) => diff > 0);
    const totalRise = rises.reduce((s, [, diff]) => s + diff, 0);
    for (const [label, diff] of rises) parts[d].set(label, (diff / totalRise) * alert[d]);
  }

  // ── Overall: worst + 0.2 × second, then absolute red flags as floors ──
  const [worst, second] = rankDomains(alert);
  const combined = alert[worst] + alert[second] * SECOND_DOMAIN_WEIGHT;
  const flag = vitalsFlag(state);
  const unsteadyUp = isNightHour(state.timeOfDay, baseline)
    && timeUp(state, baseline) >= 0.5 && standing.fall >= UNSTEADY_UP_FALL;
  const floors: [string, number][] = [];
  if (flag !== 'none') floors.push([vitalsFlagLabel(state, flag), VITALS_FLOOR[flag]]);
  if (unsteadyUp) floors.push([UNSTEADY_UP_LABEL, UNSTEADY_UP_FLOOR]);
  const [floorLabel, floor] = floors.reduce<[string, number]>((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  const total = Math.max(combined, floor);
  alert.overall = clamp(total);

  // ── Explanation: points toward the overall alert ──
  const points = new Map<string, number>();
  const add = (label: string, p: number) => { if (p > 0) points.set(label, (points.get(label) ?? 0) + p); };
  for (const [d, w] of [[worst, 1], [second, SECOND_DOMAIN_WEIGHT]] as const) {
    for (const [label, p] of parts[d]) add(label, p * w);
  }
  if (floor > combined) add(floorLabel, floor - combined);
  const scale = total > 0 ? alert.overall / total : 0;
  const factors: ExplanationFactor[] = [...points]
    .map(([factor, p]) => ({ factor, points: p * scale }))
    .sort((a, b) => b.points - a.points);

  return { standing, usual, alert, explanation: explain(factors, alert.overall, resident.name) };
}

function explain(factors: ExplanationFactor[], overall: number, name: string): ExplanationOutput {
  const topFactors = factors.slice(0, 3);
  const score = Math.round(overall);
  const lead = topFactors.slice(0, 2)
    .map(f => `${f.factor[0].toLowerCase()}${f.factor.slice(1)} (+${Math.round(f.points)})`)
    .join(' and ');
  let narrative: string;
  switch (urgencyBand(overall)) {
    case 'Low':
      narrative = lead
        ? `Overall urgency is low (${score}/100). The biggest changes from ${name}'s usual are ${lead}.`
        : `Overall urgency is low (${score}/100). ${name} is close to usual.`;
      break;
    case 'Medium':
      narrative = `Overall urgency is moderate (${score}/100): ${lead} above ${name}'s usual. ` +
        `These patterns are being monitored.`;
      break;
    case 'High':
      narrative = `Overall urgency is high (${score}/100): ${lead} above ${name}'s usual. ` +
        `Timely support is recommended.`;
      break;
  }
  return { factors, topFactors, narrative };
}
