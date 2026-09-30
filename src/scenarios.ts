import type { Chapter } from './chapters';

export type ScenarioSignal = 'mobility' | 'restlessness' | 'speechDrift' | 'socialIsolation' | 'heartRate' | 'spO2';

/** [hour, value] pairs, hours ascending. */
export type Keyframes = [number, number][];

export interface Scenario {
  id: string;
  name: string;
  description: string;
  seed: number;
  useWearables: boolean;
  keyframes: Partial<Record<ScenarioSignal, Keyframes>>;
  chapters: Chapter[];
  residentId: string;       // whose day this is      // story beats shown under the playback bar
}

/** Linear interpolation; holds the first/last value outside the keyframe range. */
export function valueAt(keyframes: Keyframes, hour: number): number {
  if (hour <= keyframes[0][0]) return keyframes[0][1];
  for (let i = 1; i < keyframes.length; i++) {
    const [h1, v1] = keyframes[i];
    if (hour <= h1) {
      const [h0, v0] = keyframes[i - 1];
      return v0 + ((v1 - v0) * (hour - h0)) / (h1 - h0);
    }
  }
  return keyframes[keyframes.length - 1][1];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'sundowning',
    residentId: 'margaret',
    name: 'Sundowning evening',
    description: 'Calm day; confusion and restlessness build from late afternoon into the night.',
    seed: 1701,
    useWearables: false,
    chapters: [{ hour: 0, title: 'Calm day' }, { hour: 17, title: 'Confusion builds' }, { hour: 19, title: 'Staff check-in' }, { hour: 21, title: 'Escalation' }],
    keyframes: {
      speechDrift: [[14, 45], [16, 60], [17, 72], [19, 85], [20, 92], [23, 92]],
      restlessness: [[0, 15], [6, 15], [8, 32], [15, 32], [17, 50], [19, 62], [21, 72], [23, 80]],
      mobility: [[16, 62], [23, 50]],
    },
  },
  {
    id: 'uti',
    residentId: 'eleanor',
    name: 'UTI onset',
    description: 'Sudden overnight confusion with a rising heart rate; staff respond and she recovers by evening.',
    seed: 2402,
    useWearables: true,
    chapters: [{ hour: 1, title: 'Confusion begins' }, { hour: 2, title: 'Bed exits' }, { hour: 4, title: 'Escalated' }, { hour: 14, title: 'Recovering' }],
    keyframes: {
      speechDrift: [[0, 22], [2, 45], [5, 72], [7, 85], [11, 85], [14, 60], [17, 40], [21, 28], [23, 25]],
      restlessness: [[0, 30], [2, 64], [3, 74], [5, 76], [8, 50], [14, 32], [20, 22], [22, 15]],
      mobility: [[0, 68], [5, 52], [12, 52], [18, 64], [21, 70]],
      heartRate: [[0, 76], [3, 98], [6, 114], [11, 116], [13, 100], [15, 90], [23, 80]],
    },
  },
  {
    id: 'withdrawn',
    residentId: 'joseph',
    name: 'Withdrawn day',
    description: 'Isolation creeps up and movement drops; gentle prompts all day, no staff alerts.',
    seed: 3103,
    useWearables: true,
    chapters: [{ hour: 0, title: 'Quiet night' }, { hour: 7, title: 'Normal morning' }, { hour: 10, title: 'Gentle prompts' }, { hour: 17, title: 'Evening alone' }],
    keyframes: {
      socialIsolation: [[7, 62], [10, 80], [13, 86], [17, 88], [23, 88]],
      mobility: [[7, 58], [12, 48], [23, 46]],
      restlessness: [[0, 15], [6, 15], [7, 20], [13, 12], [23, 12]],
    },
  },
  {
    id: 'restless-night',
    residentId: 'walter',
    name: 'Restless night',
    description: 'Repeated bed exits and unsteady movement in the small hours; a tired but calm day.',
    seed: 4204,
    useWearables: false,
    chapters: [{ hour: 0, title: 'Bed exits begin' }, { hour: 3, title: 'Escalated' }, { hour: 6, title: 'Settling' }, { hour: 9, title: 'Tired but calm' }],
    keyframes: {
      restlessness: [[0, 55], [1, 75], [4, 85], [6, 45], [9, 35], [20, 35], [22, 15]],
      mobility: [[0, 38], [2, 32], [4, 30], [7, 38], [12, 42], [23, 42]],
    },
  },
];
