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

function randWalk(current: number, lo: number, hi: number, step: number, rng: () => number): number {
  const delta = (rng() - 0.5) * 2 * step;
  return Math.max(lo, Math.min(hi, current + delta));
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
  let highStreak = 0;
  let prevLevel: InterventionLevel = 1;

  for (let h = 0; h < 24; h++) {
    state.timeOfDay = h;
    const night = isNightHour(h, baseline);

    if (scenario) applyScenario(state, scenario, h, rng);
    else randomDrift(state, night, rng);

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

function randomDrift(state: CurrentState, night: boolean, rng: () => number): void {
  // Drift sliders with random walk
  state.mobility = randWalk(state.mobility, 15, 95, night ? 12 : 6, rng);
  state.restlessness = randWalk(state.restlessness, 5, 90, night ? 15 : 8, rng);
  state.speechDrift = randWalk(state.speechDrift, 5, 85, 5, rng);
  state.socialIsolation = randWalk(state.socialIsolation, 10, 90, 6, rng);

  if (state.useWearables) {
    state.heartRate = randWalk(state.heartRate, 50, 130, 5, rng);
    state.spO2 = randWalk(state.spO2, 88, 100, 1.5, rng);
  }

  // Night patterns
  if (night) {
    state.restlessness += rng() > 0.7 ? 12 : -3;
    state.mobility -= rng() > 0.6 ? 8 : 0;
  } else {
    state.socialIsolation -= rng() > 0.5 ? 5 : -3;
  }

  // Clamp
  state.mobility = Math.max(0, Math.min(100, state.mobility));
  state.restlessness = Math.max(0, Math.min(100, state.restlessness));
  state.speechDrift = Math.max(0, Math.min(100, state.speechDrift));
  state.socialIsolation = Math.max(0, Math.min(100, state.socialIsolation));
  if (state.useWearables) {
    state.heartRate = Math.max(40, Math.min(140, state.heartRate));
    state.spO2 = Math.max(85, Math.min(100, state.spO2));
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
  if (logged('loneliness') && (!night || bands.loneliness === 'Low')) {
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
