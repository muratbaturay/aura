# Seeded Simulation & Scenario Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducible 24h simulation (seeded PRNG) plus four scripted, keyframed demo scenarios, with a consecutive-High Level 4 rule and a cancellable playback UI.

**Architecture:** A pure `rng.ts` supplies a seeded generator; `scenarios.ts` holds story data and keyframe interpolation; `simulate24h` takes `{ rng, scenario? }` and records the High streak it used per hour; `main.ts` plays snapshots back using that streak, adds scenario/seed controls, and guards runs with a run id.

**Tech Stack:** TypeScript (vanilla), Vite 7, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-30-seeded-scenarios-design.md`

## Global Constraints

- One day per scenario: 24 hourly steps, hours 0–23.
- Scenarios: Sundowning evening, UTI onset, Withdrawn day, Restless night.
- Noise: ±3 on 0–100 signals, ±2 bpm heart rate, ±0.3 % SpO2; clamp 0–100, HR 40–140, SpO2 85–100.
- Level 4 repetition: overall High now AND `highStreak >= 2` (consecutive High hours before now); non-High hour resets streak to 0.
- Trigger text: `Level 4: overall urgency has been High for 3+ hours in a row.`
- Playback: stories 500 ms/hour; random day 120 ms/hour.
- No new runtime dependencies.

## Review Focus

1. Seed box contains junk ("abc", "-5", "3.7", "1e12", blank) → blank/junk means a fresh random seed, numbers are normalized to a non-negative integer; never NaN state. (Task 1 `parseSeed` tests.)
2. A story turns wearables on; after it ends the wearables toggle and vitals sliders must show that state, and Random day afterwards must not silently keep stale vitals hidden. (Task 5 sync step + browser check.)
3. Reset or a second Simulate click mid-run → the old loop stops; no further state writes, no LLM calls from a stale loop. (Task 5 run-id guard + browser check.)
4. The level shown during playback must equal the level the simulation computed for that hour. (Task 3 test + Task 5 playback step.)
5. Story arcs must hold for non-default seeds typed by a presenter. (Task 4 tests over 25 seeds.)

---

### Task 1: Seeded RNG and seed parsing

**Files:**
- Create: `src/rng.ts`
- Test: `src/rng.test.ts`

**Interfaces:**
- Produces: `createRng(seed: number): () => number` (values in `[0, 1)`), `randomSeed(): number` (1–999999), `parseSeed(text: string): number | null`.

- [ ] **Step 1: Write the failing tests** — `src/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRng, parseSeed } from './rng';

describe('createRng', () => {
  const take = (seed: number, n = 5) => { const r = createRng(seed); return Array.from({ length: n }, r); };

  it('repeats the same sequence for the same seed', () => {
    expect(take(42)).toEqual(take(42));
  });

  it('gives different sequences for different seeds', () => {
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays in [0, 1) for edge-case seeds', () => {
    for (const seed of [0, -7, 3.7, 1e12, Number.MAX_SAFE_INTEGER]) {
      for (const v of take(seed, 200)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('parseSeed', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['abc', null],
    ['42', 42],
    [' 42 ', 42],
    ['-5', 5],
    ['3.7', 3],
  ] as const)('%j → %s', (text, expected) => {
    expect(parseSeed(text)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/rng.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement** `src/rng.ts`:

```ts
/** Deterministic PRNG (mulberry32). Same seed → same sequence, values in [0, 1). */
export function createRng(seed: number): () => number {
  let a = Math.trunc(Math.abs(seed)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh seed for a random day (UI only). */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999999);
}

/** Seed box text → seed, or null when blank/invalid (meaning "pick a new one"). */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(Math.abs(n)) : null;
}
```

- [ ] **Step 4: Run** `npx vitest run` — expect all PASS.
- [ ] **Step 5: Commit** `git add src/rng.ts src/rng.test.ts && git commit -m "Add seeded RNG and seed parsing"`

---

### Task 2: Level 4 on 3+ consecutive High hours

**Files:**
- Modify: `src/intervention.ts` (`selectIntervention` third param + rule + trigger; `buildIntervention` repeated-pattern wording)
- Modify: `src/main.ts` (rename `recentHighCount` → `highStreak`)
- Test: `src/escalation.test.ts`

**Interfaces:**
- Produces: `selectIntervention(state, risks, highStreak: number)` — `highStreak` = consecutive High-overall hours before now.

- [ ] **Step 1: Update tests first** in `src/escalation.test.ts`:
  - Rename helper param `recentHighCount` → `highStreak`.
  - Replace `'gives Level 4 after 3 consecutive High hours'` with:

```ts
  it('gives Level 4 on the third High hour in a row', () => {
    expect(evaluate({ speechDrift: 100 }, 2).intervention.level).toBe(4);
    expect(evaluate({ speechDrift: 100 }, 1).intervention.level).toBe(3);
  });

  it('drops out of Level 4 as soon as overall is no longer High, whatever the streak', () => {
    expect(evaluate({}, 5).intervention.level).toBe(1);
    expect(evaluate({ socialIsolation: 70 }, 5).intervention.level).toBe(2);
  });
```

  - In the trigger table replace the `[{}, 3, …]` row with `[{ speechDrift: 100 }, 2, /Level 4: overall urgency has been High for 3\+ hours in a row/]`.
  - Replace `'does not quote a Low current score…'` with:

```ts
  it('explains a streak escalation in the staff message', () => {
    expect(evaluate({ speechDrift: 100 }, 2).intervention.staffMessage).toMatch(/3\+ hours in a row/);
  });
```

- [ ] **Step 2: Run** `npx vitest run` — expect the new/changed tests to FAIL (baseline with streak 5 is L4 today; wording differs).
- [ ] **Step 3: Implement** in `src/intervention.ts`: rename param to `highStreak`; replace the `recentHighCount >= 3` branch with

```ts
  } else if (overallBand === 'High' && highStreak >= 2) {
    level = 4;
    trigger = 'Level 4: overall urgency has been High for 3+ hours in a row.';
```

  and the repeated-pattern `whyEscalate` with `` `Overall urgency High for 3+ hours in a row (now ${Math.round(risks.overall)}%). Prompt attention needed.` ``. In `src/main.ts` rename `recentHighCount` → `highStreak` everywhere (keep the manual-input resets).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `git commit -am "Level 4 on 3+ consecutive High hours; streak resets on any non-High hour"`

---

### Task 3: Keyframes and seeded `simulate24h`

**Files:**
- Create: `src/scenarios.ts` (types, `valueAt`, `SCENARIOS` initially `[]`)
- Modify: `src/simulation.ts`, `src/types.ts` (`SimulationSnapshot.highStreak`)
- Test: `src/simulation.test.ts`

**Interfaces:**
- Consumes: `createRng` (Task 1), `selectIntervention(state, risks, highStreak)` (Task 2).
- Produces: `ScenarioSignal`, `Keyframes`, `Scenario` types; `valueAt(keyframes: Keyframes, hour: number): number`; `SCENARIOS: Scenario[]`; `simulate24h(baseline, initialState, options: { rng: () => number; scenario?: Scenario }): SimulationSnapshot[]`; `SimulationSnapshot.highStreak: number`.

- [ ] **Step 1: Write failing tests** — `src/simulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks } from './risk';
import { selectIntervention } from './intervention';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { valueAt, type Scenario } from './scenarios';

const TEST_SCENARIO: Scenario = {
  id: 'test', name: 'Test', description: '', seed: 1, useWearables: true,
  keyframes: { speechDrift: [[0, 20], [12, 80]], heartRate: [[0, 70], [23, 115]] },
};
const run = (seed: number, scenario?: Scenario, initial = defaultState()) =>
  simulate24h(DEFAULT_BASELINE, initial, { rng: createRng(seed), scenario });

describe('valueAt', () => {
  const k: [number, number][] = [[4, 10], [8, 30], [10, 20]];
  it.each([[0, 10], [4, 10], [6, 20], [8, 30], [9, 25], [10, 20], [23, 20]])('hour %s → %s', (h, v) => {
    expect(valueAt(k, h)).toBeCloseTo(v, 9);
  });
});

describe('simulate24h', () => {
  it('replays a random day exactly for the same seed', () => {
    expect(run(7)).toEqual(run(7));
  });

  it('gives a different random day for a different seed', () => {
    expect(run(7).map(s => s.state.mobility)).not.toEqual(run(8).map(s => s.state.mobility));
  });

  it('replays a scenario exactly for the same seed', () => {
    expect(run(3, TEST_SCENARIO)).toEqual(run(3, TEST_SCENARIO));
  });

  it('ignores the slider state when a scenario runs', () => {
    const odd = { ...defaultState(), mobility: 5, socialIsolation: 95, useWearables: false };
    expect(run(3, TEST_SCENARIO, odd)).toEqual(run(3, TEST_SCENARIO));
  });

  it('follows the keyframes within the noise band', () => {
    const snaps = run(3, TEST_SCENARIO);
    expect(snaps).toHaveLength(24);
    expect(snaps[12].state.speechDrift).toBeGreaterThanOrEqual(77);
    expect(snaps[12].state.speechDrift).toBeLessThanOrEqual(83);
    expect(snaps[0].state.useWearables).toBe(true);
    expect(snaps[5].state.mobility).toBe(defaultState().mobility); // un-keyframed signal stays put
  });

  it('records the High streak each hour used, matching the level it shows', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const snaps = run(seed, TEST_SCENARIO);
      expect(snaps[0].highStreak).toBe(0);
      for (const s of snaps) {
        const risks = computeRisks(s.state, computeDeviations(DEFAULT_BASELINE, s.state), DEFAULT_BASELINE);
        expect(s.intervention.level).toBe(selectIntervention(s.state, risks, s.highStreak).level);
      }
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/simulation.test.ts` — expect FAIL (no `scenarios` module).
- [ ] **Step 3: Implement.** `src/scenarios.ts`:

```ts
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
```

  `src/types.ts`: add `highStreak: number; // consecutive High-overall hours before this one` to `SimulationSnapshot`.

  `src/simulation.ts`: signature `simulate24h(baseline, initialState, options: { rng: () => number; scenario?: Scenario })`; `randWalk` takes `rng`; replace every `Math.random()` with `rng()`; split the per-hour drift into `randomDrift(state, night, rng)` (existing logic + clamps) and `applyScenario(state, scenario, hour, rng)`:

```ts
const NOISE: Record<ScenarioSignal, number> = {
  mobility: 3, restlessness: 3, speechDrift: 3, socialIsolation: 3, heartRate: 2, spO2: 0.3,
};
const RANGE: Record<ScenarioSignal, [number, number]> = {
  mobility: [0, 100], restlessness: [0, 100], speechDrift: [0, 100], socialIsolation: [0, 100],
  heartRate: [40, 140], spO2: [85, 100],
};

function applyScenario(state: CurrentState, scenario: Scenario, hour: number, rng: () => number): void {
  for (const [signal, keyframes] of Object.entries(scenario.keyframes) as [ScenarioSignal, Keyframes][]) {
    const [lo, hi] = RANGE[signal];
    const noisy = valueAt(keyframes, hour) + (rng() - 0.5) * 2 * NOISE[signal];
    state[signal] = Math.max(lo, Math.min(hi, noisy));
  }
}
```

  Start state: `scenario ? { ...defaultState(), useWearables: scenario.useWearables } : { ...initialState }`. Streak loop:

```ts
    const intervention = selectIntervention(state, risks, highStreak);
    snapshots.push({ hour: h, state: { ...state }, risks: { ...risks }, intervention: { ...intervention }, events, highStreak });
    highStreak = urgencyBand(risks.overall) === 'High' ? highStreak + 1 : 0;
```

  In `src/main.ts` `runSimulation`, pass `{ rng: createRng(randomSeed()) }` for now and set `highStreak = snap.highStreak` before `update()` (delete the local recount).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Seeded simulate24h with keyframed scenarios and per-hour High streak"`

---

### Task 4: The four stories

**Files:**
- Modify: `src/scenarios.ts` (`SCENARIOS`)
- Test: `src/scenarios.test.ts`

**Interfaces:**
- Consumes: `simulate24h`, `createRng`, `Scenario`.
- Produces: `SCENARIOS` with ids `sundowning`, `uti`, `withdrawn`, `restless-night`.

- [ ] **Step 1: Write failing tests** — `src/scenarios.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE, defaultState } from './baseline';
import { createRng } from './rng';
import { simulate24h } from './simulation';
import { SCENARIOS } from './scenarios';

// [hour, allowed levels]; hours chosen well clear of transitions
const TARGETS: Record<string, [number, number[]][]> = {
  sundowning: [[10, [1]], [13, [1]], [17, [2]], [20, [3, 4]], [22, [4]], [23, [4]]],
  uti: [[3, [3, 4]], [8, [4]], [10, [4]], [15, [2]], [20, [1]]],
  withdrawn: [[2, [1]], [7, [1]], [13, [2]], [17, [2]], [21, [2]]],
  'restless-night': [[2, [3, 4]], [4, [4]], [5, [4]], [12, [1]], [16, [1]]],
};
const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

describe('scenario stories', () => {
  it('has exactly the four stories', () => {
    expect(SCENARIOS.map(s => s.id).sort()).toEqual(Object.keys(TARGETS).sort());
  });

  for (const [id, targets] of Object.entries(TARGETS)) {
    it(`${id} hits its target levels for 25 seeds and its default seed`, () => {
      const scenario = SCENARIOS.find(s => s.id === id)!;
      for (const seed of [scenario.seed, ...SEEDS]) {
        const snaps = simulate24h(DEFAULT_BASELINE, defaultState(), { rng: createRng(seed), scenario });
        for (const [hour, allowed] of targets) {
          expect(allowed, `${id} seed ${seed} hour ${hour}`).toContain(snaps[hour].intervention.level);
        }
      }
    });
  }

  it('turns wearables on only for the UTI story', () => {
    expect(SCENARIOS.filter(s => s.useWearables).map(s => s.id)).toEqual(['uti']);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/scenarios.test.ts` — expect FAIL (`SCENARIOS` empty).
- [ ] **Step 3: Implement** `SCENARIOS` (starting values from the probe; tune until Step 4 passes — adjust keyframes, never the targets):

```ts
export const SCENARIOS: Scenario[] = [
  {
    id: 'sundowning',
    name: 'Sundowning evening',
    description: 'Calm day; confusion and restlessness build from late afternoon into the night.',
    seed: 1701,
    useWearables: false,
    keyframes: {
      speechDrift: [[14, 20], [17, 55], [20, 85], [23, 85]],
      restlessness: [[14, 25], [18, 45], [21, 65], [23, 75]],
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
      speechDrift: [[0, 22], [2, 45], [5, 72], [7, 85], [11, 85], [17, 45], [23, 35]],
      restlessness: [[0, 30], [2, 60], [4, 72], [8, 50], [14, 32], [23, 35]],
      mobility: [[0, 68], [5, 52], [12, 52], [18, 64]],
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
      mobility: [[7, 68], [13, 50], [23, 50]],
      restlessness: [[7, 25], [13, 15], [23, 15]],
    },
  },
  {
    id: 'restless-night',
    name: 'Restless night',
    description: 'Repeated bed exits and unsteady movement in the small hours; a tired but calm day.',
    seed: 4204,
    useWearables: false,
    keyframes: {
      restlessness: [[0, 55], [1, 75], [4, 85], [6, 45], [9, 30], [23, 30]],
      mobility: [[0, 60], [2, 38], [4, 35], [7, 55], [12, 62], [23, 62]],
    },
  },
];
```

- [ ] **Step 4: Run** `npx vitest run` — expect PASS (tune keyframes if a seed misses; record any tuning in the commit message).
- [ ] **Step 5: Commit** `git add src/scenarios.ts src/scenarios.test.ts && git commit -m "Add four demo scenario stories with seed-robust target tests"`

---

### Task 5: Scenario & seed controls, cancellable playback

**Files:**
- Modify: `src/main.ts`, `src/style.css`, `README.md`

**Interfaces:**
- Consumes: `SCENARIOS`, `createRng`, `randomSeed`, `parseSeed`, `simulate24h(…, { rng, scenario })`, `SimulationSnapshot.highStreak`.

- [ ] **Step 1: Markup** — in `buildHTML()` insert before `<div class="btn-row">`:

```html
    <div class="section-header">…play icon…Scenario</div>
    <div class="control-group">
      <label for="scenarioSelect">Story</label>
      <select id="scenarioSelect" class="text-input"></select>
      <p id="scenarioDesc" class="scenario-desc"></p>
    </div>
    <div class="control-group">
      <label for="seedInput">Seed</label>
      <input type="text" inputmode="numeric" id="seedInput" class="text-input" placeholder="new each run" autocomplete="off" />
      <p id="seedNote" class="scenario-desc"></p>
    </div>
```

- [ ] **Step 2: Wiring** — populate the select with `<option value="">Random day</option>` + one option per `SCENARIOS`; on change set description (random: "Random drift from the current sliders.") and `seedInput.value = scenario ? String(scenario.seed) : ''`.
- [ ] **Step 3: Run guard + playback** — module state `let runId = 0;`. `runSimulation`:

```ts
  const myRun = ++runId;
  const scenario = SCENARIOS.find(s => s.id === scenarioSelect.value);
  const seed = parseSeed(seedInput.value) ?? randomSeed();
  const snapshots = simulate24h(DEFAULT_BASELINE, state, { rng: createRng(seed), scenario });
  setRunning(true, scenario?.name ?? 'Random day');
  for (const snap of snapshots) {
    if (myRun !== runId) return;               // Reset or a newer run took over
    simSnapshots.push(snap);
    Object.assign(state, snap.state);
    timelineEvents.push(...snap.events);
    highStreak = snap.highStreak;
    syncSlidersFromState();
    syncWearablesUI();
    update();
    await sleep(scenario ? 500 : 120);
  }
  if (myRun !== runId) return;
  seedNote.textContent = `Ran seed ${seed}`;
  setRunning(false, 'Complete');
  update();
```

  `resetAll()` does `runId++` and `setRunning(false, 'Idle')`. `setRunning(on, label)` sets `simRunning`, disables/enables every slider, `wearToggle`, `scenarioSelect`, `seedInput`, `btnRandomize`, `btnSimulate`, and sets the chip text (`Running · ${label}` when on). `syncWearablesUI()` sets `wearToggle.checked = state.useWearables` and toggles `#vitalsSection.hidden`; reuse it in `resetAll` and the toggle handler.
- [ ] **Step 4: CSS** — `.scenario-desc { font-size: var(--fs-xs); color: var(--c-text-dim); margin: var(--sp-1) 0 0; }` and `select.text-input { width: 100%; }`.
- [ ] **Step 5: README** — add a "Scenario Presets" feature bullet listing the four stories and seeding; update the Simulation bullet.
- [ ] **Step 6: Verify** — `npm test && npm run build`; in the browser: play each story (watch ladder + trigger), Reset mid-run stops playback, UTI leaves wearables toggle on, random day shows "Ran seed N" and replays identically when that seed is typed.
- [ ] **Step 7: Commit** `git add src/main.ts src/style.css README.md && git commit -m "Scenario and seed controls with cancellable playback"`
