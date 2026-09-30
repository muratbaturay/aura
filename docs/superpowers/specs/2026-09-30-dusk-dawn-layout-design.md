# Dusk & Dawn Layout — Design

**Date:** 2026-09-30
**Status:** Approved in conversation ("go ahead with all of it, include the acknowledgement"); spec/plan review gates waived by the user.
**Source design:** Artifact canvas "AURA Redesign Concepts" (artboards Main, Night, Studio, System).
**Builds on:** branch `feat/halo-score-bar` (status halo + explanation score bar).

## Goal

Bring the app to the Dusk & Dawn canvas: warm day theme and night-safe night theme that follow the simulated clock, a 24-hour ring, playback controls with story chapters, a three-column care view with a "What AURA is doing" card and staff acknowledgement, the simulator controls moved into a Scenario studio drawer, and the new type.

## Decisions

| Topic | Decision |
|---|---|
| Theme switch | Automatic: night when `isNightHour(state.timeOfDay, baseline)` (22:00–06:00), day otherwise. `data-theme="day|night"` on `<html>`; all colours are tokens with day and night values. |
| Palette | Day: paper `#F4EFE6`, card `#FBF8F2`, ink `#1F1C18`. Night: umber `#14110D`, card `#1D1914`, cream `#EFE5D3`. Levels day `#C9DCE3 #E8B96A #D9763F #9E2B25`, night `#7F97A1 #D2A24F #DB7B45 #E5553F`. Teal accents retire. |
| Type | Fraunces (scores, headings, quotes), Instrument Sans (UI), IBM Plex Mono (times, points, seeds). DM Sans removed. |
| Layout | Header; three columns: Status (halo + domains + vitals) · Today/Tonight (ring, playback, chapters, events) · Why + What AURA is doing. Stacks to one column under 1100 px. |
| Charts | "24h Risk Trends" and "Baseline vs Current" move into the Scenario studio drawer, recoloured with tokens. The ring replaces them on the main surface. |
| Ring | 24 hourly segments from 00 at top, clockwise. Past hours coloured by intervention level; future hours neutral; night hours (22–06) marked by an outer arc; a "now" dot on the current hour. Manual mode (no run): only the current hour is coloured. |
| Playback | A controller over the 24 snapshots: play, pause, previous/next hour, scrub to any hour, stop. Speed: Fast 0.12 s, Narrate 0.5 s, Slow 1 s per hour; stories default to Narrate, Random day to Fast. Scrubbing works during and after a run. |
| LLM gating | LLM calls stay off from run start until playback reaches its last hour. After the run, scrubbing to an earlier hour is review mode: no LLM calls. Manual slider input ends the run (history cleared) and re-enables normal gating. |
| Chapters | Stories carry authored chapters (hour + title). Random day derives chapters from level changes (at most 4). Each chapter is past / now / upcoming; clicking one seeks there. |
| What AURA is doing | Rows: "Said to Eleanor" (resident message, serif italic quote), "Sent to staff" (staff message), "Room" (environment). Source badge (Template / AI-Generated) and LLM loading/error kept in the card header. |
| Acknowledgement | When a staff alert is raised (level rises to ≥ 3, or rises from 3 to 4), the card shows "Waiting for a staff member to acknowledge" with a live m:ss timer and an **Acknowledge** button. Acknowledging shows "Acknowledged after m:ss". Level falling below 3 clears it; a further rise raises a new alert. UI state only — it does not change risk or level. Timer uses wall-clock time. |
| Scenario studio | Right-side drawer (dialog, 440 px): story cards with 24-hour arc strips (from the story's default seed), seed + New seed, speed segmented control, Play / Randomize / Reset, manual signal sliders, wearables, staff load, LLM settings, the two charts. Opens from the header button; Esc, close button and backdrop close it; focus returns to the opener. Play closes the drawer and starts playback. |
| Header | "aura" wordmark; "Eleanor, 82" + "Care view" (night: "Care view · night display"); story chip (name · seed · Running/Paused/Complete) when a run exists; clock with sun/moon icon, HH:MM and Morning/Afternoon/Evening/Night; Scenario studio button. |
| Motion | Halo breathing, ack pulse and theme transition all stop under `prefers-reduced-motion`. |

## Modules

- `src/theme.ts` — `themeFor(hour, baseline): 'day' | 'night'`, `partOfDay(hour)`.
- `src/ring.ts` — `ringSegments(levels, nowHour)`, `ringPoint(hour, radius, center)`.
- `src/playback.ts` — `createPlayback({ length, onFrame, onEnd, intervalMs })` → `{ play, pause, seek, step, stop, setInterval, state }`.
- `src/chapters.ts` — `levelChapters(levels)`, `chaptersView(chapters, nowHour)`.
- `src/ack.ts` — `ackReducer(state, event)` and `ackLabel(state, now)`.
- `src/ui/` — DOM pieces for the ring, drawer and doing card, keeping `main.ts` as wiring.
- `src/scenarios.ts` — `chapters` on each scenario.

## Testing

Pure modules are unit-tested first (Vitest, fake timers for playback). DOM wiring is verified in the browser: both themes, a full story with pause/scrub/chapter seek, acknowledgement, drawer keyboard behaviour, and phone width.

## Out of scope

Staff phone app, shareable URLs, multi-day runs, acknowledgement affecting the model.
