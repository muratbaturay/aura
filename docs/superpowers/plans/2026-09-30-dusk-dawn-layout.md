# Dusk & Dawn Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin and restructure the app to the Dusk & Dawn canvas: clock-driven day/night theme, 24-hour ring, playback with chapters, "What AURA is doing" with staff acknowledgement, and a Scenario studio drawer.

**Architecture:** Pure logic in small tested modules (`theme`, `ring`, `playback`, `chapters`, `ack`); DOM pieces in `src/ui/`; `main.ts` stays the wiring. Colours are CSS tokens with day and night values switched by `data-theme` on `<html>`.

**Tech Stack:** TypeScript (vanilla), Vite 7, Vitest 5 (fake timers).

**Spec:** `docs/superpowers/specs/2026-09-30-dusk-dawn-layout-design.md`

## Global Constraints

- Night = `isNightHour(hour, DEFAULT_BASELINE)` (22:00–06:00).
- Day tokens: paper `#F4EFE6`, card `#FBF8F2`, ink `#1F1C18`; night: `#14110D`, `#1D1914`, `#EFE5D3`.
- Levels day `#C9DCE3 #E8B96A #D9763F #9E2B25`; night `#7F97A1 #D2A24F #DB7B45 #E5553F`.
- Fonts: Fraunces, Instrument Sans, IBM Plex Mono (Google Fonts); no DM Sans, Inter, Roboto, Arial.
- Speeds: Fast 120 ms, Narrate 500 ms, Slow 1000 ms per hour; stories default Narrate, random day Fast.
- No LLM calls from run start until the last hour; none while reviewing an earlier hour after a run.
- Acknowledgement is UI state only; wall-clock timer `m:ss`.
- Touch targets ≥ 44 px; all motion off under `prefers-reduced-motion`; text contrast ≥ 4.5:1 in both themes.
- No new runtime dependencies.

## Review Focus

1. Theme flips at 22:00/06:00 during playback and on manual time changes; charts and drawer must stay legible in night theme (no hard-coded light colours left). (Task 1 grep step + Task 6 browser check.)
2. Pause/scrub/chapter-seek/Reset/new run in any order → no stale frames, no double timers, no LLM call mid-run. (Task 3 fake-timer tests + Task 4 browser check.)
3. Acknowledge, then level rises 3→4 → a new pending alert; level drops below 3 → cleared; scrubbing backwards and forwards behaves the same way. (Task 5 reducer tests.)
4. Drawer: Esc/backdrop/close all close it, focus returns to the opener, Tab doesn't escape into the page behind while open. (Task 2 browser check.)
5. Phone width: single column, ring scales down, no horizontal scroll. (Task 6 browser check.)

---

### Task 1: Theme tokens, fonts and `theme.ts`

**Files:** Create `src/theme.ts`, `src/theme.test.ts`. Modify `index.html`, `src/styles/tokens.css`, `src/chart.ts`, `src/main.ts` (apply theme in `update()`).

**Interfaces — Produces:** `themeFor(hour: number, baseline: ResidentBaseline): 'day' | 'night'`; `partOfDay(hour: number): 'Morning' | 'Afternoon' | 'Evening' | 'Night'`.

- [ ] **Step 1: Failing tests** — `src/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE } from './baseline';
import { themeFor, partOfDay } from './theme';

describe('themeFor', () => {
  it.each([[21.5, 'day'], [22, 'night'], [3, 'night'], [5.9, 'night'], [6, 'day'], [14, 'day']] as const)(
    'hour %s → %s', (h, t) => expect(themeFor(h, DEFAULT_BASELINE)).toBe(t));
});

describe('partOfDay', () => {
  it.each([[5, 'Morning'], [11.9, 'Morning'], [12, 'Afternoon'], [16.5, 'Afternoon'], [17, 'Evening'],
    [21.9, 'Evening'], [22, 'Night'], [4, 'Night'], [24, 'Night']] as const)(
    'hour %s → %s', (h, p) => expect(partOfDay(h)).toBe(p));
});
```

- [ ] **Step 2:** `npx vitest run src/theme.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/theme.ts`:

```ts
import type { ResidentBaseline } from './types';
import { isNightHour } from './baseline';

export type Theme = 'day' | 'night';

/** The interface follows the resident's clock: night-safe colours while they sleep. */
export function themeFor(hour: number, baseline: ResidentBaseline): Theme {
  return isNightHour(hour, baseline) ? 'night' : 'day';
}

export function partOfDay(hour: number): 'Morning' | 'Afternoon' | 'Evening' | 'Night' {
  const h = Math.floor(((hour % 24) + 24) % 24);
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 22) return 'Evening';
  return 'Night';
}
```

- [ ] **Step 4: Tokens + fonts.** `index.html`: replace the DM Sans link with Fraunces (ital, opsz, 300–700), Instrument Sans (400–700), IBM Plex Mono (400, 500). `tokens.css`: rewrite palette values to the day palette under `:root`, add `:root[data-theme="night"]` overrides for every colour token, add `--ff-display`, `--ff-mono`, `--c-level-1..4` (both themes), `--c-shade-1..5` (night: cream → dark), `--ring-future`, `--ring-gap`, `--ring-night`, and `transition: background-color .4s, color .4s` on `body` (off under reduced motion). Map the retired teal tokens to ink so existing components keep working.
- [ ] **Step 5: Charts use tokens.** In `src/chart.ts` replace every hex colour with `var(--…)` tokens (text, grid, baseline, current, series); series colours = level tokens 4/2/1 for fall/cognitive/loneliness.
- [ ] **Step 6: Apply.** In `update()`: `document.documentElement.dataset.theme = themeFor(state.timeOfDay, DEFAULT_BASELINE)`.
- [ ] **Step 7: Verify** `npm test && npx tsc --noEmit`; `grep -n "#[0-9a-fA-F]\{6\}" src/chart.ts src/main.ts` returns no colour literals used for rendering.
- [ ] **Step 8: Commit** "Clock-driven day/night theme, Dusk & Dawn tokens and type".

---

### Task 2: Header, three-column layout and Scenario studio drawer

**Files:** Create `src/ui/drawer.ts`. Modify `src/main.ts` (template + wiring), `src/style.css`, `src/styles/components.css`.

**Interfaces — Produces:** `createDrawer(root: HTMLElement, opener: HTMLElement): { open(): void; close(): void; isOpen(): boolean }`.

- [ ] **Step 1: Template.** Header: wordmark, resident block (`#residentSub` text "Care view" / "Care view · night display"), `#storyChip` (hidden when no run), clock (`#clockIcon`, `#clockTime`, `#clockPart`), `#btnStudio`. Main: `.care-grid` with `#colStatus` (existing status card + `#vitalsRow`), `#colDay` (`#ringCard` placeholder, `#playbackBar`, `#chapters`, event timeline card), `#colWhy` (Why card, Doing card). Drawer: `<div id="studioBackdrop">` + `<aside id="studio" role="dialog" aria-modal="true" aria-labelledby="studioTitle">` containing: story cards list, seed row + New seed, speed segmented control, Play / Randomize / Reset, existing sliders, wearables, staff load, LLM settings, both charts.
- [ ] **Step 2: Story cards.** Built once from `SCENARIOS` + "Random day": name, description, meta ("peaks at L4 · seed 1701" / "any seed"), 24-cell arc from `simulate24h(DEFAULT_BASELINE, defaultState(), { rng: createRng(s.seed), scenario: s })` levels; `aria-pressed` on the selected card; selecting fills seed and speed default.
- [ ] **Step 3: Drawer behaviour** in `src/ui/drawer.ts`: open → backdrop + panel visible, `inert` on the page behind, focus first focusable; close on Esc / backdrop click / close button; restore focus to opener.
- [ ] **Step 4: Play from drawer** closes the drawer then starts the run.
- [ ] **Step 5: CSS.** `.care-grid { display:grid; grid-template-columns: 360px minmax(0,1fr) 400px; gap: 24px }`, one column under 1100 px; cards radius 28 px on `--c-bg-raised`; drawer 440 px fixed right, full height, scroll inside.
- [ ] **Step 6: Verify** tests + tsc; browser: open/close three ways, focus return, Tab stays in drawer, a story still plays.
- [ ] **Step 7: Commit** "Three-column care view with header and Scenario studio drawer".

---

### Task 3: Playback controller

**Files:** Create `src/playback.ts`, `src/playback.test.ts`. Modify `src/main.ts` (replace the `for`/`sleep` loop and `runId`).

**Interfaces — Produces:** `createPlayback(o: { length: number; intervalMs: number; onFrame(i: number): void; onEnd(): void }): Playback` with `play()`, `pause()`, `seek(i)`, `step(delta)`, `stop()`, `setIntervalMs(ms)`, `state(): { index: number; status: 'idle'|'playing'|'paused'|'ended' }`.

- [ ] **Step 1: Failing tests** — `src/playback.test.ts` (fake timers):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlayback } from './playback';

function setup(length = 4, intervalMs = 100) {
  const frames: number[] = [];
  let ended = 0;
  const p = createPlayback({ length, intervalMs, onFrame: i => frames.push(i), onEnd: () => { ended++; } });
  return { p, frames, ended: () => ended };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createPlayback', () => {
  it('shows frame 0 at once, advances one frame per interval and ends once', () => {
    const { p, frames, ended } = setup();
    p.play();
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(300);
    expect(frames).toEqual([0, 1, 2, 3]);
    expect(ended()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(ended()).toBe(1);
    expect(p.state()).toEqual({ index: 3, status: 'ended' });
    vi.advanceTimersByTime(1000);
    expect(frames).toEqual([0, 1, 2, 3]);
    expect(ended()).toBe(1);
  });

  it('pauses and resumes from the same frame', () => {
    const { p, frames } = setup();
    p.play(); vi.advanceTimersByTime(100); p.pause();
    vi.advanceTimersByTime(500);
    expect(frames).toEqual([0, 1]);
    p.play(); vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1, 2]);
  });

  it('continues from a seeked frame while playing', () => {
    const { p, frames } = setup(10);
    p.play(); p.seek(6); vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 6, 7]);
  });

  it('steps by one while paused, clamped to the ends', () => {
    const { p, frames } = setup();
    p.seek(0); p.step(-1); p.step(1); p.step(5);
    expect(frames).toEqual([0, 0, 1, 3]);
    expect(p.state().status).toBe('paused');
  });

  it('never shows a frame after stop', () => {
    const { p, frames } = setup();
    p.play(); p.stop(); vi.advanceTimersByTime(1000);
    expect(frames).toEqual([0]);
    expect(p.state()).toEqual({ index: -1, status: 'idle' });
  });

  it('changes speed mid-play', () => {
    const { p, frames } = setup(10, 100);
    p.play(); p.setIntervalMs(500); vi.advanceTimersByTime(400);
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1]);
  });

  it('restarts from the first frame when played after the end', () => {
    const { p, frames } = setup(2);
    p.play(); vi.advanceTimersByTime(200);
    p.play();
    expect(frames).toEqual([0, 1, 0]);
  });
});
```

- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: Implement** `src/playback.ts`:

```ts
export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended';

export interface Playback {
  play(): void;
  pause(): void;
  seek(index: number): void;
  step(delta: number): void;
  stop(): void;
  setIntervalMs(ms: number): void;
  state(): { index: number; status: PlaybackStatus };
}

/** Steps through `length` frames on a timer; one pending timer at most. */
export function createPlayback(o: {
  length: number; intervalMs: number; onFrame(i: number): void; onEnd(): void;
}): Playback {
  let index = -1;
  let status: PlaybackStatus = 'idle';
  let interval = o.intervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  const show = (i: number) => { index = i; o.onFrame(i); };
  const schedule = () => { clear(); timer = setTimeout(tick, interval); };
  function tick() {
    timer = null;
    if (status !== 'playing') return;
    if (index >= o.length - 1) { status = 'ended'; o.onEnd(); return; }
    show(index + 1);
    schedule();
  }
  const clamp = (i: number) => Math.max(0, Math.min(o.length - 1, i));

  return {
    play() {
      if (status === 'playing') return;
      if (status === 'ended' || index < 0) show(0);
      status = 'playing';
      schedule();
    },
    pause() { if (status === 'playing') { clear(); status = 'paused'; } },
    seek(i) {
      show(clamp(i));
      if (status === 'playing') schedule();
      else status = 'paused';
    },
    step(delta) { this.pause(); this.seek((index < 0 ? 0 : index) + delta); },
    stop() { clear(); status = 'idle'; index = -1; },
    setIntervalMs(ms) { interval = ms; if (status === 'playing') schedule(); },
    state: () => ({ index, status }),
  };
}
```

  Note the steps test: `seek(0)` from idle shows 0 and pauses; `step(-1)` clamps to 0 and shows it again.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Wire** in `main.ts`: `runSimulation` builds snapshots, creates the playback with `onFrame(i)` = apply snapshot i (state, events up to i, `highStreak`, ring/chapters/ack update, `update()`), `onEnd` = mark complete, unlock controls, final `update()` (LLM may fire). `resetAll` and manual input call `playback?.stop()` and clear history. Playback bar: prev / play-pause / next buttons (`aria-label`s, play/pause icon swaps), scrubber `<input type="range" min=0 max=23>` bound to `seek`, time labels, speed label. Speed control in the drawer calls `setIntervalMs`.
- [ ] **Step 6:** tests + tsc; browser: play, pause, scrub, next/prev, Reset mid-run, a second run, and confirm LLM call count stays 0 during a run with LLM enabled but no key (gate reached via status only).
- [ ] **Step 7: Commit** "Playback controller with pause, scrub and speed".

---

### Task 4: 24-hour ring and chapters

**Files:** Create `src/ring.ts`, `src/ring.test.ts`, `src/chapters.ts`, `src/chapters.test.ts`, `src/ui/ring.ts`. Modify `src/scenarios.ts` (+ `chapters`), `src/scenarios.test.ts`, `src/main.ts`.

**Interfaces — Produces:** `ringSegments(levels: (InterventionLevel | null)[], nowHour: number, baseline): RingSegment[]` (`{ hour, fill: InterventionLevel | 'future', isNow, isNight }`), `ringGradient(segments)`, `nightArcGradient(segments)`, `ringPoint(hour, radius, center): { x, y }`; `Chapter = { hour: number; title: string }`, `levelChapters(levels: InterventionLevel[]): Chapter[]`, `chaptersView(chapters, nowHour: number): { hour, title, timeLabel, status: 'past'|'now'|'upcoming' }[]`; `Scenario.chapters: Chapter[]`.

- [ ] **Step 1: Failing tests** — `src/ring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE } from './baseline';
import { ringSegments, ringGradient, nightArcGradient, ringPoint } from './ring';

const levels = [2, 3, ...Array(22).fill(null)];

describe('ringSegments', () => {
  it('colours hours with data by level and the rest as future', () => {
    const segs = ringSegments(levels, 1, DEFAULT_BASELINE);
    expect(segs).toHaveLength(24);
    expect(segs.slice(0, 3).map(s => s.fill)).toEqual([2, 3, 'future']);
  });
  it('marks the current hour and the night hours', () => {
    const segs = ringSegments(levels, 1.5, DEFAULT_BASELINE);
    expect(segs.filter(s => s.isNow).map(s => s.hour)).toEqual([1]);
    expect(segs.filter(s => s.isNight).map(s => s.hour)).toEqual([0, 1, 2, 3, 4, 5, 22, 23]);
  });
});

describe('ringGradient', () => {
  it('draws each hour as a 15° slice with 1° gaps, from 00 at the top', () => {
    const g = ringGradient(ringSegments(levels, 1, DEFAULT_BASELINE));
    expect(g.startsWith('conic-gradient(')).toBe(true);
    expect(g).toContain('var(--c-level-2) 1deg 14deg');
    expect(g).toContain('var(--c-level-3) 16deg 29deg');
    expect(g).toContain('var(--ring-future) 31deg 44deg');
  });
  it('marks night hours on the outer arc', () => {
    const g = nightArcGradient(ringSegments(levels, 1, DEFAULT_BASELINE));
    expect(g).toContain('var(--ring-night) 0deg 15deg');
    expect(g).toContain('transparent 90deg 105deg');
    expect(g).toContain('var(--ring-night) 330deg 345deg');
  });
});

describe('ringPoint', () => {
  it.each([[0, 200, 100], [6, 300, 200], [12, 200, 300], [18, 100, 200]] as const)(
    'hour %s sits at (%s, %s)', (h, x, y) => {
      const p = ringPoint(h, 100, 200);
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBeCloseTo(y, 6);
    });
});
```

  `src/chapters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { levelChapters, chaptersView } from './chapters';

describe('levelChapters', () => {
  it('starts a chapter at hour 0 and at each level change', () => {
    expect(levelChapters([1, 1, 2, 2, 3, 3, 1, 1])).toEqual([
      { hour: 0, title: 'Calm' }, { hour: 2, title: 'Gentle prompt' },
      { hour: 4, title: 'Staff soft alert' }, { hour: 6, title: 'Calm' },
    ]);
  });
  it('keeps hour 0 and the three highest-level changes when there are more than four', () => {
    const ch = levelChapters([1, 2, 1, 3, 1, 4, 1, 2]);
    expect(ch.map(c => c.hour)).toEqual([0, 1, 3, 5]);
  });
});

describe('chaptersView', () => {
  const ch = [{ hour: 0, title: 'A' }, { hour: 5, title: 'B' }, { hour: 9, title: 'C' }];
  it('marks past, now and upcoming chapters with HH:00 labels', () => {
    expect(chaptersView(ch, 6)).toEqual([
      { hour: 0, title: 'A', timeLabel: '00:00', status: 'past' },
      { hour: 5, title: 'B', timeLabel: '05:00', status: 'now' },
      { hour: 9, title: 'C', timeLabel: '09:00', status: 'upcoming' },
    ]);
  });
  it('has no current chapter before the first one starts', () => {
    expect(chaptersView([{ hour: 3, title: 'A' }], 1)[0].status).toBe('upcoming');
  });
});
```

  Add to `src/scenarios.test.ts`: every scenario has 2–4 chapters, hours ascending within 0–23.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `src/ring.ts` (gap `var(--ring-gap)` 0–1° and 14–15° of each slice; future `var(--ring-future)`; night arc `var(--ring-night)` for night slices else `transparent`; `ringPoint` angle `hour × 15°` clockwise from top: `x = c + r·sin`, `y = c − r·cos`), `src/chapters.ts` (titles `{1:'Calm',2:'Gentle prompt',3:'Staff soft alert',4:'Escalation'}`; over four → keep hour 0 plus the three highest-level changes, earliest on ties, sorted by hour), and `chapters` on each scenario:
  - sundowning: 0 Calm day · 17 Confusion builds · 19 Staff check-in · 21 Escalation
  - uti: 1 Confusion begins · 2 Bed exits · 4 Escalated · 14 Recovering
  - withdrawn: 0 Quiet night · 7 Normal morning · 10 Gentle prompts · 17 Evening alone
  - restless-night: 0 Bed exits begin · 3 Escalated · 6 Settling · 9 Tired but calm
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Render** `src/ui/ring.ts`: ring card (480 px box; outer night arc, hour ring from `ringGradient`, inner disc with NOW / HH:MM / "Level N since HH:00" / next day-night boundary; now dot at `ringPoint(now+0.5, 172, 240)`; 00/06/12/18 labels; legend). Scales with `width: min(480px, 100%)` + `aspect-ratio: 1` and percentage positions. Chapters row under the playback bar; clicking a chapter seeks there. Manual mode: ring shows only the current hour; chapters hidden.
- [ ] **Step 6:** tests + tsc; browser: ring fills during a story, dot moves, night arc correct, chapter click seeks.
- [ ] **Step 7: Commit** "24-hour ring and story chapters".

---

### Task 5: "What AURA is doing" and staff acknowledgement

**Files:** Create `src/ack.ts`, `src/ack.test.ts`. Modify `src/main.ts` (`renderIntervention` → doing card), CSS.

**Interfaces — Produces:** `AckState`, `ackReducer(state, event)`, `formatElapsed(ms): string`.

- [ ] **Step 1: Failing tests** — `src/ack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ackReducer, formatElapsed, type AckState } from './ack';

const none: AckState = { status: 'none' };
const lvl = (level: 1 | 2 | 3 | 4, now: number) => ({ type: 'level' as const, level, now });

describe('ackReducer', () => {
  it('raises a pending alert when the level reaches 3', () => {
    expect(ackReducer(none, lvl(2, 0))).toEqual(none);
    expect(ackReducer(none, lvl(3, 1000))).toEqual({ status: 'pending', level: 3, since: 1000 });
  });
  it('records acknowledgement time', () => {
    const s = ackReducer(ackReducer(none, lvl(3, 1000)), { type: 'acknowledge', now: 43000 });
    expect(s).toEqual({ status: 'acknowledged', level: 3, since: 1000, at: 43000 });
  });
  it('raises a new alert when the level rises again, even after acknowledgement', () => {
    let s = ackReducer(none, lvl(3, 0));
    s = ackReducer(s, { type: 'acknowledge', now: 5000 });
    s = ackReducer(s, lvl(4, 9000));
    expect(s).toEqual({ status: 'pending', level: 4, since: 9000 });
  });
  it('keeps the alert while the level stays at 3 or above without rising', () => {
    let s = ackReducer(none, lvl(4, 0));
    s = ackReducer(s, lvl(3, 1000));
    expect(s).toEqual({ status: 'pending', level: 3, since: 0 });
    s = ackReducer(s, lvl(4, 2000));
    expect(s).toEqual({ status: 'pending', level: 4, since: 2000 });
  });
  it('clears when the level falls below 3, and on reset', () => {
    expect(ackReducer(ackReducer(none, lvl(3, 0)), lvl(2, 1))).toEqual(none);
    expect(ackReducer(ackReducer(none, lvl(4, 0)), { type: 'reset' })).toEqual(none);
  });
  it('ignores acknowledge when nothing is pending', () => {
    expect(ackReducer(none, { type: 'acknowledge', now: 1 })).toEqual(none);
  });
});

describe('formatElapsed', () => {
  it.each([[0, '0:00'], [42000, '0:42'], [61500, '1:01'], [600000, '10:00'], [-5, '0:00']] as const)(
    '%s ms → %s', (ms, s) => expect(formatElapsed(ms)).toBe(s));
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `src/ack.ts` per the tests (`level` event: < 3 → none; none → pending; level > state.level → new pending at `now`; else keep status/since, update level).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Doing card.** Replace the intervention card body: header "What AURA is doing" + source badge + loading dot; rows with inline stroke icons (speaker / bell / lamp): "Said to Eleanor" (serif italic quote, omitted at Level 1), "Sent to staff · HH:MM" (omitted when no staff message), "Room". Ack row when pending/acknowledged: pulse dot (pending), text, live `m:ss` (1 s interval while pending, cleared otherwise), **Acknowledge** button (44 px) while pending. Dispatch a `level` event after each `update()`, `reset` on Reset and manual-mode run start. LLM error message stays in this card.
- [ ] **Step 6:** tests + tsc; browser: UTI story pauses at 04:00 with a pending timer; Acknowledge → "Acknowledged after m:ss"; resume → recovery clears it.
- [ ] **Step 7: Commit** "What AURA is doing card with staff acknowledgement".

---

### Task 6: Polish pass, README, full verification

**Files:** `README.md`, CSS as needed.

- [ ] **Step 1:** Night-theme sweep of every surface (drawer, charts, event badges, LLM config inputs, buttons) — fix any hard-coded light colours to tokens.
- [ ] **Step 2:** Phone width (375 px): single column, ring scales, drawer full width, no horizontal scroll.
- [ ] **Step 3:** Reduced motion: halo, pulse and theme transition off.
- [ ] **Step 4:** README: features (theme, ring, playback, chapters, acknowledgement, studio), structure (new modules).
- [ ] **Step 5:** `npm test && npm run build`; commit "Dusk & Dawn polish and docs".
