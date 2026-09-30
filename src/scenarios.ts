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
    name: 'Sundowning evening',
    description: 'Calm day; confusion and restlessness build from late afternoon into the night.',
    seed: 1701,
    useWearables: false,
    keyframes: {
      speechDrift: [[14, 20], [17, 55], [20, 85], [23, 85]],
      restlessness: [[0, 15], [6, 15], [8, 25], [14, 25], [18, 45], [21, 65], [23, 75]],
      mobility: [[16, 70], [23, 55]],
    },
  },
  {
    id: 'uti',
    name: 'UTI onset',
    description: 'Sudden overnight confusion with a rising heart rate; staff respond and she recovers by evening.',
    seed: 2402,
    useWearables: true,
    keyframes: {
      speechDrift: [[0, 22], [2, 45], [5, 72], [7, 85], [11, 85], [17, 45], [21, 28], [23, 25]],
      restlessness: [[0, 30], [2, 60], [4, 72], [8, 50], [14, 32], [20, 22], [22, 15]],
      mobility: [[0, 68], [5, 52], [12, 52], [18, 64], [21, 70]],
      heartRate: [[0, 76], [3, 98], [6, 114], [11, 116], [15, 94], [23, 84]],
    },
  },
  {
    id: 'withdrawn',
    name: 'Withdrawn day',
    description: 'Isolation creeps up and movement drops; gentle prompts all day, no staff alerts.',
    seed: 3103,
    useWearables: false,
    keyframes: {
      socialIsolation: [[7, 25], [11, 58], [17, 66], [23, 66]],
      mobility: [[0, 72], [7, 68], [13, 50], [23, 50]],
      restlessness: [[0, 15], [6, 15], [7, 25], [13, 15], [23, 15]],
    },
  },
  {
    id: 'restless-night',
    name: 'Restless night',
    description: 'Repeated bed exits and unsteady movement in the small hours; a tired but calm day.',
    seed: 4204,
    useWearables: false,
    keyframes: {
      restlessness: [[0, 55], [1, 75], [4, 85], [6, 45], [9, 30], [20, 25], [22, 15]],
      mobility: [[0, 60], [2, 38], [4, 35], [7, 55], [12, 62], [20, 68], [23, 70]],
    },
  },
];
