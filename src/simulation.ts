import type { ResidentBaseline, CurrentState, RiskScores, TimelineEvent, SimulationSnapshot, InterventionOutput, InterventionLevel } from './types';
import { computeDeviations, defaultState, isNightHour } from './baseline';
import { computeRisks, urgencyBand, vitalsFlag } from './risk';
import { selectIntervention } from './intervention';
import { valueAt } from './scenarios';
import type { Scenario, ScenarioSignal, Keyframes } from './scenarios';

export interface SimulationOptions {
  rng: () => number;       // seeded generator — same seed, same day
  scenario?: Scenario;     // scripted story; omitted = random day from initialState
}

// Scenario noise amplitude and clamp range per signal
const NOISE: Record<ScenarioSignal, number> = {
  mobility: 3, restlessness: 3, speechDrift: 3, socialIsolation: 3, heartRate: 2, spO2: 0.3,
};
const RANGE: Record<ScenarioSignal, [number, number]> = {
  mobility: [0, 100], restlessness: [0, 100], speechDrift: [0, 100], socialIsolation: [0, 100],
  heartRate: [40, 140], spO2: [85, 100],
};

/**
 * A random day depends on its seed *and* the sliders it started from. When the
 * same seed runs again, start from where that run started (not where it left
 * the sliders at 23:00), so typing a shown seed back in replays the day exactly.
 */
export function startStateFor(
  seed: number,
  current: CurrentState,
  lastRun: { seed: number; start: CurrentState } | null
): CurrentState {
  return lastRun && lastRun.seed === seed ? { ...lastRun.start } : { ...current };
}

export function simulate24h(
  baseline: ResidentBaseline,
  initialState: CurrentState,
  options: SimulationOptions
): SimulationSnapshot[] {
  const { rng, scenario } = options;
  const snapshots: SimulationSnapshot[] = [];
  // A scenario starts from the default resident so slider positions can't change the story
  const state: CurrentState = scenario
    ? { ...defaultState(), useWearables: scenario.useWearables }
    : { ...initialState };
  const usual: CurrentState = { ...initialState }; // a random day drifts back toward where it started
  let highStreak = 0;
  let prevLevel: InterventionLevel = 1;

  for (let h = 0; h < 24; h++) {
    state.timeOfDay = h;
    const night = isNightHour(h, baseline);

    if (scenario) applyScenario(state, scenario, h, rng);
    else randomDrift(state, usual, night, rng);

    const devs = computeDeviations(baseline, state);
    const risks = computeRisks(state, devs, baseline);
    const intervention = selectIntervention(state, risks, highStreak);
    const events = generateEvents(h, state, risks, night, intervention, prevLevel);
    prevLevel = intervention.level;

    snapshots.push({
      hour: h,
      state: { ...state },
      risks: { ...risks },
      intervention: { ...intervention },
      events,
      highStreak,
    });

    highStreak = urgencyBand(risks.overall) === 'High' ? highStreak + 1 : 0;
  }

  return snapshots;
}

function applyScenario(state: CurrentState, scenario: Scenario, hour: number, rng: () => number): void {
  for (const [signal, keyframes] of Object.entries(scenario.keyframes) as [ScenarioSignal, Keyframes][]) {
    const [lo, hi] = RANGE[signal];
    const noisy = valueAt(keyframes, hour) + (rng() - 0.5) * 2 * NOISE[signal];
    state[signal] = Math.max(lo, Math.min(hi, noisy));
  }
}

// Random-day dynamics: each hour a signal moves part of the way back toward its
// target, plus a little noise. Awake, the target is her usual level; asleep,
// restlessness settles, broken by occasional wake-ups (more often when frail).
const PULL_AWAKE = 0.3;
const PULL_ASLEEP = 0.6;
const SLEEP_RESTLESSNESS = 15;

function randomDrift(state: CurrentState, usual: CurrentState, night: boolean, rng: () => number): void {
  const noise = (amp: number) => (rng() - 0.5) * 2 * amp;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pull = (x: number, target: number, k: number, amp: number, lo = 0, hi = 100) =>
    clamp(x + k * (target - x) + noise(amp), lo, hi);

  if (night) {
    const frailty = ((100 - usual.mobility) + usual.restlessness) / 200;   // 0 steady & calm … 1 frail & restless
    const wakes = rng() < 0.04 + 0.3 * frailty;
    if (wakes) {
      // Up for part of the hour: restless and a little unsteady
      state.restlessness = 60 + rng() * 25;
      state.mobility = clamp(state.mobility - 5 - rng() * 10, 0, 100);
    } else {
      state.restlessness = pull(state.restlessness, SLEEP_RESTLESSNESS, PULL_ASLEEP, 3);
      state.mobility = pull(state.mobility, usual.mobility, PULL_AWAKE, 3);
    }
  } else {
    state.restlessness = pull(state.restlessness, usual.restlessness, PULL_AWAKE, 6);
    state.mobility = pull(state.mobility, usual.mobility, PULL_AWAKE, 5);
  }
  state.speechDrift = pull(state.speechDrift, usual.speechDrift, PULL_AWAKE, 4);
  state.socialIsolation = pull(state.socialIsolation, usual.socialIsolation, PULL_AWAKE, 5);

  if (state.useWearables) {
    state.heartRate = pull(state.heartRate, usual.heartRate, PULL_AWAKE, 4, 40, 140);
    state.spO2 = pull(state.spO2, usual.spO2, PULL_AWAKE, 1, 85, 100);
  }
}

const ACTION_LABELS: Record<InterventionLevel, string> = {
  1: 'Ambient cue',
  2: 'Gentle prompt to Eleanor',
  3: 'Staff soft alert sent',
  4: 'Escalated: priority to staff',
};

/**
 * What the day log records for one hour. Signal events follow the same bands as
 * the scores (Medium and High only), so every hour that climbs the ladder shows
 * why; sensor events (bed exit, wandering, vitals) keep their own triggers; and
 * AURA's own actions are logged whenever the ladder moves to Level 2 or above.
 */
function generateEvents(
  hour: number,
  state: CurrentState,
  risks: RiskScores,
  night: boolean,
  intervention: InterventionOutput,
  prevLevel: InterventionLevel,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const h = `${hour.toString().padStart(2, '0')}:00`;
  const add = (label: string, urgency: TimelineEvent['urgency'], detail: string) =>
    events.push({ time: hour, label, urgency, detail });

  // ── Signals, by the model's bands ──
  // A concern is logged when its own band is Medium or High, or when it is the
  // main driver of a Medium/High overall score that no single concern reaches.
  const bands = {
    fall: urgencyBand(risks.fall),
    cognitive: urgencyBand(risks.cognitive),
    loneliness: urgencyBand(risks.loneliness),
  };
  const driver = (['fall', 'cognitive', 'loneliness'] as const)
    .reduce((a, b) => (risks[b] > risks[a] ? b : a));
  const combinedOnly = urgencyBand(risks.overall) !== 'Low' && Object.values(bands).every(b => b === 'Low');
  const logged = (d: keyof typeof bands) => bands[d] !== 'Low' || (combinedOnly && d === driver);
  const driverNote = (d: keyof typeof bands) =>
    bands[d] === 'Low' ? ` Main driver of overall ${Math.round(risks.overall)}%.` : '';

  if (logged('fall')) {
    add('Fall risk elevated', bands.fall, `Fall risk ${Math.round(risks.fall)}% at ${h}.${driverNote('fall')}`);
  }
  if (logged('cognitive')) {
    add('Confusion signs', bands.cognitive,
      `Cognitive concern ${Math.round(risks.cognitive)}% · speech clarity drift ${Math.round(state.speechDrift)}% at ${h}.${driverNote('cognitive')}`);
  }
  // Isolation is a daytime signal, unless it is what sets tonight's level
  if (logged('loneliness') && (!night || (driver === 'loneliness' && urgencyBand(risks.overall) !== 'Low'))) {
    add('Isolation noted', bands.loneliness,
      `Loneliness ${Math.round(risks.loneliness)}% · social isolation trend ${Math.round(state.socialIsolation)}% at ${h}.${driverNote('loneliness')}`);
  }

  // ── Sensor events ──
  if (night && state.restlessness > 55) {
    add('Bed exit detected', bands.fall, `Restlessness ${Math.round(state.restlessness)}% at ${h}. Path lighting activated.`);
  }
  if (night && state.restlessness > 65 && state.mobility < 45) {
    add('Wandering pattern', bands.cognitive === 'Low' ? 'Medium' : bands.cognitive, `Nighttime movement with reduced stability at ${h}.`);
  }
  const vitals = vitalsFlag(state);
  if (vitals !== 'none') {
    add('Vitals flag', vitals === 'red' ? 'High' : 'Medium',
      `SpO2 ${+state.spO2.toFixed(1)}%, HR ${Math.round(state.heartRate)} bpm (${vitals}) at ${h}.`);
  }

  // ── What AURA did ──
  if (intervention.level >= 2 && intervention.level !== prevLevel) {
    add('AURA acted', intervention.level === 2 ? 'Medium' : 'High', `${ACTION_LABELS[intervention.level]} at ${h}.`);
  }

  return events;
}
