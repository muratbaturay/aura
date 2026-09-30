# Seeded Simulation & Scenario Presets — Design

**Date:** 2026-09-30
**Status:** Approved (conversation), implementation authorized without spec review gate

## Goal

Make the 24h simulation reproducible and add scripted scenario presets for **live stakeholder demos**. Each preset is a one-day story that reliably walks the intervention ladder along a specific path, the same way every time.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Purpose | Live demos to stakeholders |
| Time span | One day (24 hourly steps) per scenario; no multi-day |
| Scenarios | Sundowning evening, UTI onset, Withdrawn day, Restless night |
| Driving approach | Keyframed storylines + small seeded noise (option A) |
| Level 4 repetition rule | "Overall High for 3+ consecutive hours, including now"; any non-High hour resets |

## Architecture

### `src/rng.ts` (new)
- `createRng(seed: number): () => number` — deterministic PRNG (mulberry32), values in `[0, 1)`.
- `randomSeed(): number` — fresh integer seed (1–999999) from `Math.random()`, UI use only.

### `src/scenarios.ts` (new)
- `ScenarioSignal` = `'mobility' | 'restlessness' | 'speechDrift' | 'socialIsolation' | 'heartRate' | 'spO2'`.
- `Keyframes` = `[hour, value][]`, hours ascending.
- `Scenario` = `{ id, name, description, seed, useWearables, keyframes: Partial<Record<ScenarioSignal, Keyframes>> }`.
- `SCENARIOS: Scenario[]` — the four stories (below).
- `valueAt(keyframes, hour)` — linear interpolation; holds first value before the first keyframe and last value after the last.

### `src/simulation.ts` (changed)
- `simulate24h(baseline, initialState, options: { rng: () => number; scenario?: Scenario })`.
- **Random day** (no scenario): existing random walk and night patterns, with every `Math.random()` replaced by `rng()`.
- **Scenario**: starts from `defaultState()` (slider positions ignored), `useWearables` from the scenario. Each hour, every keyframed signal = `valueAt(...)` + uniform noise from `rng`: ±3 on 0–100 signals, ±2 bpm heart rate, ±0.3 % SpO2; clamped to slider ranges. Un-keyframed signals stay at defaults.
- Each `SimulationSnapshot` gains `highStreak: number` — consecutive High-overall hours *before* this hour, the value passed to `selectIntervention`. After the hour: `highStreak = overall High ? highStreak + 1 : 0`.

### `src/intervention.ts` (changed)
- Third parameter renamed `highStreak` (consecutive High hours before now).
- Repetition rule: `overallBand === 'High' && highStreak >= 2` → Level 4.
- Trigger text: `Level 4: overall urgency has been High for 3+ hours in a row.`
- All other rules unchanged.

### `src/main.ts` (changed)
- `recentHighCount` → `highStreak`; manual input still resets it to 0.
- During playback the page sets `highStreak = snap.highStreak` before `update()`, so the displayed level equals `snap.intervention.level`.
- **Cancellable runs:** a run id increments on each run and on Reset; the playback loop exits when its id is stale. Reset stops a run mid-way.
- While running, sliders, wearables toggle, scenario select, seed input and Randomize are disabled.

## UI

In the controls panel, above the action buttons:
- **Scenario** `<select>`: "Random day" (default) + the four stories; a one-line description below it.
- **Seed** number input. Selecting a story fills its fixed seed. Random day leaves it empty (placeholder "new each run"); empty ⇒ `randomSeed()`. After a run, a note shows "Ran seed N".
- Playback: stories 500 ms/hour; random day keeps 120 ms/hour.
- Status chip: "Running · <scenario name>" while playing.

## Storylines (targets, before noise)

| Story | Wearables | Arc |
|---|---|---|
| Sundowning evening | off | Calm → L2 ~17:00 (orientation prompt) → L3 ~19:00 (cognitive High) → L4 from ~21:00; bed exits late |
| UTI onset | on | Confusion from ~01:00 → L3 ~02:00 → L4 ~04:00 (cognitive High + amber HR) → L2 by ~13:00 → L1 by ~18:00 |
| Withdrawn day | off | Calm morning → L2 from ~10:00 all day (loneliness Medium), never escalates to staff |
| Restless night | off | Bed exits from 00:00 → L3 ~01:00 (fall High) → L4 03:00–05:00 → L2 ~06:00 → L1 daytime |

Keyframe values are tuned during implementation so the checked hours hold across seeds.

## Testing

- `rng`: same seed ⇒ same sequence; different seeds differ; values in `[0, 1)`.
- `valueAt`: hand-computed interpolation, before-first and after-last holds.
- `simulate24h`: same seed + scenario ⇒ identical snapshots; scenario output independent of `initialState`; `snapshot.intervention.level` equals `selectIntervention(state, risks, snapshot.highStreak).level`; random day with different seeds differs.
- **Story targets:** for each story, 25 seeds; assert levels at hours well clear of transitions.
- **Level 4 rule:** L4 at High with streak ≥ 2; not L4 when current overall isn't High, whatever the streak.
- Browser: play each story; Reset mid-run stops playback.

## Out of scope

Hour scrubbing from the trend chart, multi-day runs, a red-vitals story, shareable URLs.
