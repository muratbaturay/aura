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

export const SCENARIOS: Scenario[] = [];
