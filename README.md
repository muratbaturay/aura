# AURA-Senior — Ambient Care Simulator

A browser-based simulator that models an ambient AI system for assisted-living environments. It demonstrates how continuous, non-intrusive sensor signals can be fused into real-time risk scores, escalating interventions, and natural-language care messages — all without requiring the resident to wear or operate any device.

## Features

- **Residents** — Four residents with their own normals: *Eleanor, 82* (independent, steady), *Walter, 88* (frail, history of falls, often up at night; bed-exit alert in his care plan), *Margaret, 79* (early dementia, more restless in the evening; bed-exit alert) and *Joseph, 85* (recently widowed and withdrawn; COPD, wears a monitor). Switch from the header; each story belongs to one of them.
- **Change-From-Normal Alerts** — The ladder responds to how far she is above *her own* usual level at that hour, not to absolute risk: `alert = 1.5 × 100 × (now − usual) / (100 − usual)` per area, combined as worst + 0.2 × second. At night, fall risk is compared with her usual when up as much as she is now, so a bathroom trip is not an alarm. Absolute red flags still escalate whatever her normal: amber/red vitals, being up at night with a care-plan bed-exit alert, or very unsteady (standing fall risk ≥ 85). Scores are indices, not percentages.
- **Dusk & Dawn Care View** — Three columns: the resident's status, their day, and why AURA acted / what it is doing, with the day log across the bottom. A header switch picks the theme: **Light** (default), **Dark** (a dim, warm, night-safe palette) or **Follow the clock** (dark from 22:00 to 06:00); the choice is remembered. Type: Bricolage Grotesque for headings, numbers and big type; Instrument Sans for text; IBM Plex Mono for times and points; Fraunces italic only for words spoken to the resident.
- **Scenario Studio** — A side drawer holding the simulator: story cards (each previewing its day as a 24-hour strip), seed, playback speed (fast / narrate / slow), manual sliders for time of day, mobility, restlessness, speech drift, social isolation, staff load and optional wearable vitals, the charts and the LLM settings.
- **Baseline Deviation Model** — Computes normalized z-score deltas from each resident's baseline (fixed per resident in this prototype; a real system would learn it over weeks).
- **Risk Scoring** — Deterministic weighted scoring for fall risk, cognitive concern, and loneliness (0–100 each). Fall risk counts time out of bed: awake hours count in full; at night it follows restlessness, so a resident asleep keeps about a third of her vulnerability, and being *up at night* adds its own risk. Overall urgency follows the worst domain (plus 0.2 × the second-worst), so one severe concern is never averaged away; wearable red/amber vitals put a floor under it. Bands: Low / Medium / High.
- **4-Level Intervention Ladder**
  1. Ambient Cue (lighting, music) — overall Low
  2. Gentle Prompt (resident-facing message) — overall Medium
  3. Staff Soft Alert — overall High, or amber vitals (SpO2 < 92%, HR > 110)
  4. Escalate (urgent staff notification) — red vitals (SpO2 < 90%, HR > 120), two High domains, a High domain with amber vitals, or overall High for 3+ hours in a row during a simulation (ends as soon as urgency drops out of High)

  Staff load never changes the level; when it is high it adds a prioritization note to the staff message.
- **Status Halo** — The overall score sits inside a halo coloured by the current intervention level; it breathes slower when calm and faster as the ladder climbs (8 s → 2.4 s per breath; no motion when the viewer prefers reduced motion). Below it, the intervention ladder, the three domain scores with their Medium/High thresholds, and wearable vitals when enabled.
- **Explainability Panel** — States the ladder rule that set the level, then draws the Overall score as one bar split into its contributing signals (exact additive contributions from the scoring model, so the segments add up to the score), with a legend, the 40/70 thresholds and a natural-language summary built from the same numbers.
- **24-Hour Ring** — The day as a dial: one slice per hour, coloured by intervention level as the run plays, night hours marked on an outer arc, a dot on the current hour.
- **24-Hour Simulation & Playback** — Animated walk-through of a full day. A random day drifts back toward the resident's usual levels (the sliders it started from); at night she sleeps, with occasional wake-ups that become bed exits (more often when frail or restless). Play, pause, step an hour, or scrub to any hour, during and after a run. Every run is seeded: the seed is shown after a random day, and typing it back in replays that day exactly. Adaptive (LLM) messages stay off until the run ends.
- **Story Chapters** — Each story's beats (or, for a random day, its level changes) appear under the playback bar as past / now / upcoming; click one to jump there.
- **What AURA Is Doing & Staff Acknowledgement** — What was said to the resident, what was sent to staff, and what changed in the room. When a staff alert is raised (Level 3+, or a rise to Level 4) the card waits for a staff member to acknowledge, with a live timer; acknowledging records how long it took. UI only — it does not change the risk model.
- **Scenario Presets** — Scripted one-day stories for demos, each walking the intervention ladder along a different path: *Sundowning evening* (cognitive → Level 4 at night), *UTI onset* (confusion + rising heart rate → Level 4, then recovery), *Withdrawn day* (loneliness, gentle prompts only) and *Restless night* (fall risk → Level 4 in the small hours). Each has a fixed seed so the demo plays the same way every time; stories play at 0.5 s per hour.
- **Optional LLM Messaging** — Toggle on adaptive, AI-generated resident and staff messages via any OpenAI-compatible API (OpenAI, Ollama, LM Studio). Falls back to deterministic templates when disabled.
- **SVG Charts** — Baseline vs Current bar chart and 24h risk trend lines with night-band shading, in the Scenario Studio.
- **Day Log** — Event lanes across the 24 hours: fall risk, confusion and isolation (logged whenever their band is Medium or High, or when one drives a Medium/High overall on its own), bed exits, wandering, vitals flags, and *AURA acted* (each prompt, staff alert or escalation). Every Level 2+ hour has at least one mark explaining it. Marks are coloured by severity, night hours shaded; click one to jump there and read that hour's events in plain text.

## Tech Stack


| Layer    | Choice                                        |
|----------|-----------------------------------------------|
| Bundler  | Vite 7                                        |
| Language | TypeScript (vanilla — no framework)           |
| Styling  | CSS custom properties (design token system)   |
| Charts   | Hand-rolled SVG (zero dependencies)           |
| Tests    | Vitest                                        |
| LLM      | OpenAI-compatible chat completions (optional) |
| Fonts    | DM Sans (Google Fonts)                        |


## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview
```

The app opens at `http://localhost:5173`.

## Project Structure

```
src/
├── main.ts                 # Entry point, DOM setup, state management, render loop
├── types.ts                # All TypeScript type definitions
├── baseline.ts             # Default baseline, deviation computation
├── residents.ts            # The four residents: usual levels, baselines, care-plan flags
├── assessment.ts           # Change-from-normal alert scores, red flags, explanation
├── risk.ts                 # Risk scoring, urgency bands, explanation builder
├── intervention.ts         # Intervention level selection and template messages
├── simulation.ts           # Seeded 24-hour simulation: random-walk day or keyframed scenario
├── scenarios.ts            # Scenario presets (keyframed storylines) and interpolation
├── rng.ts                  # Seeded PRNG and seed parsing
├── escalation.test.ts      # Vitest coverage for scoring and the intervention ladder
├── chart.ts                # SVG chart renderers (comparison + timeline)
├── view.ts                 # View models: halo per level, explanation score-bar segments
├── theme.ts                # Theme preference (light / dark / follow the clock) and part of day
├── ring.ts                 # 24-hour ring segments, gradients and positions
├── playback.ts             # Playback controller (play, pause, seek, step, speed)
├── chapters.ts             # Story chapters and past/now/upcoming view
├── ack.ts                  # Staff acknowledgement state (reducer)
├── lanes.ts                # Day log: events grouped into lanes by hour
├── ui/
│   ├── template.ts         # Page markup
│   ├── drawer.ts           # Scenario Studio drawer (modal side panel)
│   ├── ring.ts             # Ring rendering
│   └── icons.ts            # Inline stroke icons
├── engine/
│   └── llmMessaging.ts     # LLM controller (debounce, abort, OpenAI client)
├── style.css               # Page layout (imports tokens + components)
└── styles/
    ├── tokens.css           # Design tokens (colors, spacing, radii, shadows)
    └── components.css       # Reusable component styles
```

## LLM Configuration

1. Open **Scenario studio** → **Adaptive messages (LLM)** and enable the toggle.
2. Enter your API key (stored in localStorage, never sent anywhere except the configured base URL).
3. Optionally change the base URL and model name for local inference servers.
4. Click **Test Connection** to verify.

Compatible with any OpenAI-compatible API endpoint.

## Disclaimer

Prototype for demonstration and research purposes only. Not a medical device.

---

(c) 2026 Murat Baturay
