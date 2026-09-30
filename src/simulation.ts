import type { CurrentState, TimelineEvent, SimulationSnapshot, InterventionOutput, InterventionLevel } from './types';
import { isNightHour } from './baseline';
import { urgencyBand, vitalsFlag } from './risk';
import { assess, type Assessment } from './assessment';
import { SLEEP_RESTLESSNESS, type Resident } from './residents';
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
  resident: Resident,
  initialState: CurrentState,
  options: SimulationOptions
): SimulationSnapshot[] {
  const { rng, scenario } = options;
  const { baseline } = resident;
  const snapshots: SimulationSnapshot[] = [];
  // A story starts from its resident's usual levels, so slider positions can't change it
  const state: CurrentState = scenario
    ? { ...resident.usual, useWearables: scenario.useWearables }
    : { ...initialState };
  const usual: CurrentState = { ...initialState }; // a random day drifts back toward where it started
  const episode = scenario ? null : drawEpisode(rng);
  let highStreak = 0;
  let prevLevel: InterventionLevel = 1;

  for (let h = 0; h < 24; h++) {
    state.timeOfDay = h;
    const night = isNightHour(h, baseline);

    if (scenario) applyScenario(state, scenario, h, rng);
    else randomDrift(state, withEpisode(usual, episode, h), usual, night, resident.nightWake, rng);

    const assessment = assess(state, resident);
    const { standing, alert } = assessment;
    const intervention = selectIntervention(state, alert, highStreak, resident);
    const events = generateEvents(h, state, assessment, night, intervention, prevLevel);
    prevLevel = intervention.level;

    snapshots.push({
      hour: h,
      state: { ...state },
      risks: { ...standing },
      alert: { ...alert },
      intervention: { ...intervention },
      events,
      highStreak,
    });

    highStreak = urgencyBand(alert.overall) === 'High' ? highStreak + 1 : 0;
  }

  return snapshots;
}

// ── Off episodes: some random days depart from her normal for a few hours ──

type EpisodeKind = 'restless' | 'confused' | 'withdrawn' | 'unsteady';
interface Episode { kind: EpisodeKind; start: number; hours: number }

const EPISODE_CHANCE = 0.6;

function drawEpisode(rng: () => number): Episode | null {
  if (rng() >= EPISODE_CHANCE) return null;
  const kinds: EpisodeKind[] = ['restless', 'confused', 'withdrawn', 'unsteady'];
  const kind = kinds[Math.floor(rng() * kinds.length)];
  // A restless spell may be a bad night; the others happen in the day
  const start = kind === 'restless' && rng() < 0.5
    ? [22, 23, 0, 1, 2][Math.floor(rng() * 5)]
    : 8 + Math.floor(rng() * 11);
  return { kind, start, hours: 4 + Math.floor(rng() * 5) };
}

/** Her drift targets for this hour: usual levels, shifted while an episode lasts. */
function withEpisode(usual: CurrentState, episode: Episode | null, hour: number): CurrentState {
  if (!episode || (hour - episode.start + 24) % 24 >= episode.hours) return usual;
  const t = { ...usual };
  switch (episode.kind) {
    case 'restless': t.restlessness += 40; break;
    case 'confused': t.speechDrift += 30; break;
    case 'withdrawn': t.socialIsolation += 30; t.mobility -= 10; break;
    case 'unsteady': t.mobility -= 25; break;
  }
  return t;
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
// restlessness settles, broken by wake-ups at her own rate.
const PULL_AWAKE = 0.3;
const PULL_ASLEEP = 0.6;

function randomDrift(
  state: CurrentState, target: CurrentState, usual: CurrentState,
  night: boolean, wakeChance: number, rng: () => number,
): void {
  const noise = (amp: number) => (rng() - 0.5) * 2 * amp;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pull = (x: number, to: number, k: number, amp: number, lo = 0, hi = 100) =>
    clamp(x + k * (to - x) + noise(amp), lo, hi);

  if (night) {
    if (rng() < wakeChance) {
      // Up for part of the hour: restless and a little unsteady
      state.restlessness = 60 + rng() * 25;
      state.mobility = clamp(state.mobility - 5 - rng() * 10, 0, 100);
    } else {
      // Asleep; a restless spell keeps sleep lighter (half its daytime effect)
      const sleepTarget = SLEEP_RESTLESSNESS + Math.max(0, target.restlessness - usual.restlessness) / 2;
      state.restlessness = pull(state.restlessness, sleepTarget, PULL_ASLEEP, 3);
      state.mobility = pull(state.mobility, target.mobility, PULL_AWAKE, 3);
    }
  } else {
    state.restlessness = pull(state.restlessness, target.restlessness, PULL_AWAKE, 6);
    state.mobility = pull(state.mobility, target.mobility, PULL_AWAKE, 5);
  }
  state.speechDrift = pull(state.speechDrift, target.speechDrift, PULL_AWAKE, 4);
  state.socialIsolation = pull(state.socialIsolation, target.socialIsolation, PULL_AWAKE, 5);

  if (state.useWearables) {
    state.heartRate = pull(state.heartRate, target.heartRate, PULL_AWAKE, 4, 40, 140);
    state.spO2 = pull(state.spO2, target.spO2, PULL_AWAKE, 1, 85, 100);
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
  assessment: Assessment,
  night: boolean,
  intervention: InterventionOutput,
  prevLevel: InterventionLevel,
): TimelineEvent[] {
  const { standing, usual, alert } = assessment;
  const events: TimelineEvent[] = [];
  const h = `${hour.toString().padStart(2, '0')}:00`;
  const add = (label: string, urgency: TimelineEvent['urgency'], detail: string) =>
    events.push({ time: hour, label, urgency, detail });

  // ── Signals: change from her usual, by alert band ──
  // A concern is logged when its alert is Medium or High, or when it is the main
  // driver of a Medium/High overall alert that no single concern reaches.
  const bands = {
    fall: urgencyBand(alert.fall),
    cognitive: urgencyBand(alert.cognitive),
    loneliness: urgencyBand(alert.loneliness),
  };
  const driver = (['fall', 'cognitive', 'loneliness'] as const)
    .reduce((a, b) => (alert[b] > alert[a] ? b : a));
  const combinedOnly = urgencyBand(alert.overall) !== 'Low' && Object.values(bands).every(b => b === 'Low');
  const logged = (d: keyof typeof bands) => bands[d] !== 'Low' || (combinedOnly && d === driver);
  const driverNote = (d: keyof typeof bands) =>
    bands[d] === 'Low' ? ` Main driver of overall urgency ${Math.round(alert.overall)}.` : '';
  const vsUsual = (d: keyof typeof bands) => `${Math.round(standing[d])} (usual ${Math.round(usual[d])})`;

  if (logged('fall')) {
    add('Fall risk elevated', bands.fall, `Fall risk ${vsUsual('fall')} at ${h}.${driverNote('fall')}`);
  }
  if (logged('cognitive')) {
    add('Confusion signs', bands.cognitive,
      `Cognitive concern ${vsUsual('cognitive')} · speech clarity drift ${Math.round(state.speechDrift)} at ${h}.${driverNote('cognitive')}`);
  }
  // Isolation is a daytime signal, unless it is what sets tonight's level
  if (logged('loneliness') && (!night || (driver === 'loneliness' && urgencyBand(alert.overall) !== 'Low'))) {
    add('Isolation noted', bands.loneliness,
      `Loneliness ${vsUsual('loneliness')} · social isolation trend ${Math.round(state.socialIsolation)} at ${h}.${driverNote('loneliness')}`);
  }

  // ── Sensor events ──
  if (night && state.restlessness > 55) {
    add('Bed exit detected', bands.fall, `Restlessness ${Math.round(state.restlessness)} at ${h}. Path lighting activated.`);
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
