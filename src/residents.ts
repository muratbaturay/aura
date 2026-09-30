import type { CurrentState, ResidentBaseline } from './types';
import { isNightHour } from './baseline';

export interface Resident {
  id: string;
  name: string;
  age: number;
  summary: string;           // one line for the switcher
  contact: string;           // who the gentle prompt suggests calling
  baseline: ResidentBaseline;
  usual: CurrentState;       // her normal waking levels (timeOfDay unused)
  nightWake: number;         // chance per night hour of getting up, on a random day
  eveningRestlessness: number; // extra usual restlessness 17:00–21:59 (sundowning tendency)
}

/** Restlessness while asleep; also the sleep target of a random day. */
export const SLEEP_RESTLESSNESS = 15;

function resident(r: Omit<Resident, 'baseline' | 'usual'> & {
  usual: Omit<CurrentState, 'timeOfDay' | 'staffLoad'>;
  vars: [number, number, number, number]; // mobility, restlessness, speech, social variances
}): Resident {
  const usual: CurrentState = { timeOfDay: 14, staffLoad: 40, ...r.usual };
  const [mv, rv, sv, ov] = r.vars;
  const { vars: _vars, ...rest } = r;
  return {
    ...rest,
    usual,
    baseline: {
      mobilityMean: usual.mobility, mobilityVar: mv,
      restlessnessMean: usual.restlessness, restlessnessVar: rv,
      speechMean: usual.speechDrift, speechVar: sv,
      socialMean: usual.socialIsolation, socialVar: ov,
      sleepStart: 22, sleepEnd: 6,
    },
  };
}

export const RESIDENTS: Resident[] = [
  resident({
    id: 'eleanor', name: 'Eleanor', age: 82, contact: 'Martha',
    summary: 'Independent and steady; sleeps well.',
    usual: { mobility: 70, restlessness: 25, speechDrift: 20, socialIsolation: 30, useWearables: false, heartRate: 72, spO2: 97 },
    vars: [100, 64, 49, 81], nightWake: 0.08, eveningRestlessness: 0,
  }),
  resident({
    id: 'walter', name: 'Walter', age: 88, contact: 'his daughter Ruth',
    summary: 'Frail and unsteady, history of falls; often up at night.',
    usual: { mobility: 42, restlessness: 35, speechDrift: 22, socialIsolation: 35, useWearables: false, heartRate: 76, spO2: 96 },
    vars: [121, 81, 49, 81], nightWake: 0.22, eveningRestlessness: 0,
  }),
  resident({
    id: 'margaret', name: 'Margaret', age: 79, contact: 'her son David',
    summary: 'Early dementia; more restless in the evening.',
    usual: { mobility: 62, restlessness: 32, speechDrift: 45, socialIsolation: 30, useWearables: false, heartRate: 74, spO2: 97 },
    vars: [100, 81, 64, 81], nightWake: 0.14, eveningRestlessness: 10,
  }),
  resident({
    id: 'joseph', name: 'Joseph', age: 85, contact: 'his friend Samuel',
    summary: 'Recently widowed and withdrawn; COPD, wears a monitor.',
    usual: { mobility: 58, restlessness: 20, speechDrift: 18, socialIsolation: 62, useWearables: true, heartRate: 84, spO2: 93 },
    vars: [100, 49, 49, 100], nightWake: 0.08, eveningRestlessness: 0,
  }),
];

export const ELEANOR = RESIDENTS[0];

export function residentById(id: string): Resident {
  return RESIDENTS.find(r => r.id === id) ?? ELEANOR;
}

/** Her normal state at an hour: usual levels by day (with any evening tendency), asleep at night. */
export function usualStateAt(r: Resident, hour: number): CurrentState {
  const h = Math.floor(((hour % 24) + 24) % 24);
  if (isNightHour(h, r.baseline)) {
    return { ...r.usual, timeOfDay: hour, restlessness: SLEEP_RESTLESSNESS };
  }
  const evening = h >= 17 && h < 22 ? r.eveningRestlessness : 0;
  return { ...r.usual, timeOfDay: hour, restlessness: r.usual.restlessness + evening };
}
