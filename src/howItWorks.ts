// "How it works": the model described from its own constants, so the page and
// the docs can never drift from what the code actually does.
import { ASLEEP_SHARE, BANDS, SECOND_DOMAIN_WEIGHT, TIME_UP, VITALS_FLOOR, WEIGHTS } from './risk';
import { ALERT_GAIN, HOURS_UP_FLOORS, MIN_HEADROOM, UNSTEADY_UP_FALL, UP_AT_NIGHT_FLOOR } from './assessment';
import { HIGH_STREAK_HOURS } from './intervention';
import { RESIDENTS } from './residents';

const F = WEIGHTS.fall;
const C = WEIGHTS.cognitive;
const L = WEIGHTS.loneliness;

/** The scoring, one formula per line (z = distance from her usual, in standard deviations). */
export function formulaLines(): string[] {
  return [
    `Time up at night = (restlessness − ${TIME_UP.from}) ÷ ${TIME_UP.span}, between 0 and 1; awake hours count as fully up`,
    `Exposure = ${ASLEEP_SHARE} + ${+(1 - ASLEEP_SHARE).toFixed(2)} × time up`,
    `Fall risk = exposure × (${F.unsteadiness} × (100 − mobility) + ${F.lessSteadyThanBaseline} × z below usual mobility`
      + ` + ${F.restlessness} × restlessness + ${F.moreRestlessThanBaseline} × z above usual restlessness`
      + ` + ${F.heartRate} × heart-rate beats above ${F.heartRateFrom} + ${F.spo2} × SpO2 points below ${F.spo2From})`
      + ` + ${F.upAtNight} × time up at night`,
    `Cognitive concern = ${C.speechDrift} × speech drift + ${C.moreDriftThanBaseline} × z above usual speech drift`
      + ` + ${C.nightRestlessness} × restlessness at night`,
    `Activity = ${L.activityMobility} × mobility + ${L.activityCalm} × (100 − restlessness)`,
    `Loneliness = ${L.isolation} × isolation + ${L.moreIsolatedThanBaseline} × z above usual isolation`
      + ` + ${L.lowActivity} × max(0, ${L.activityFloor} − activity)`,
    `Each area is capped at 100; overall = worst area + ${SECOND_DOMAIN_WEIGHT} × second-worst`,
    `Change from usual (per area) = ${ALERT_GAIN} × 100 × (now − usual) ÷ max(${MIN_HEADROOM}, 100 − usual), and 0 when at or below usual`,
    `Bands: Low < ${BANDS.medium} ≤ Medium < ${BANDS.high} ≤ High`,
  ];
}

/** What each level of the ladder needs; urgency is the change from usual, with red-flag floors. */
export function ladderLines(): string[] {
  return [
    `Level 1 · Ambient cue: urgency Low`,
    `Level 2 · Gentle prompt to the resident: urgency Medium`,
    `Level 3 · Staff soft alert: urgency High, or amber vitals`,
    `Level 4 · Escalate: red vitals, two areas High, one area High with amber vitals, or urgency High for ${HIGH_STREAK_HOURS}+ hours in a row`,
  ];
}

/** Absolute red flags: they set a floor under urgency whatever the resident's normal. */
export function redFlagLines(): string[] {
  const hours = [...HOURS_UP_FLOORS].sort((a, b) => a[0] - b[0])
    .map(([n, floor]) => `${n}+ hours in a row out of bed at night: urgency at least ${floor}`);
  return [
    `Vitals outside the resident's care-plan targets: amber lifts urgency to at least ${VITALS_FLOOR.amber}, red to at least ${VITALS_FLOOR.red}`,
    `Up at night with a care-plan bed-exit alert: urgency at least ${UP_AT_NIGHT_FLOOR}`,
    `Up at night and very unsteady (fall risk ≥ ${UNSTEADY_UP_FALL}): urgency at least ${UP_AT_NIGHT_FLOOR}`,
    ...hours,
    `Staff workload never changes the level; it only adds a note to the staff message`,
  ];
}

export interface ResidentRow {
  name: string;
  age: number;
  summary: string;
  usual: string;
  wearables: string;
  vitals: string;
  bedExitAlert: 'yes' | 'no';
  nightWake: string;
}

export function residentRows(): ResidentRow[] {
  return RESIDENTS.map(r => ({
    name: r.name,
    age: r.age,
    summary: r.summary,
    usual: `${r.usual.mobility} · ${r.usual.restlessness} · ${r.usual.speechDrift} · ${r.usual.socialIsolation}`,
    wearables: r.usual.useWearables ? 'yes' : 'no',
    vitals: `SpO2 amber < ${r.vitals.spo2Amber}, red < ${r.vitals.spo2Red}`,
    bedExitAlert: r.bedExitAlert ? 'yes' : 'no',
    nightWake: `${Math.round(r.nightWake * 100)}% of night hours`,
  }));
}
