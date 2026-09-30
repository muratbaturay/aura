# AURA-Senior — Ambient Care Simulator

A browser-based simulator that models an ambient AI system for assisted-living environments. It demonstrates how continuous, non-intrusive sensor signals can be fused into real-time risk scores, escalating interventions, and natural-language care messages — all without requiring the resident to wear or operate any device.

## Features

- **Scenario Controls** — Adjust time of day, mobility, restlessness, speech drift, social isolation, staff load, and optional wearable vitals (heart rate, SpO2) via sliders.
- **Baseline Deviation Model** — Computes normalized z-score deltas from a resident's learned baseline to detect anomalies.
- **Risk Scoring** — Deterministic weighted scoring for fall risk, cognitive concern, and loneliness (0–100 each). Overall urgency follows the worst domain (plus 0.2 × the second-worst), so one severe concern is never averaged away; wearable red/amber vitals put a floor under it. Bands: Low / Medium / High.
- **4-Level Intervention Ladder**
  1. Ambient Cue (lighting, music) — overall Low
  2. Gentle Prompt (resident-facing message) — overall Medium
  3. Staff Soft Alert — overall High, or amber vitals (SpO2 < 92%, HR > 110)
  4. Escalate (urgent staff notification) — red vitals (SpO2 < 90%, HR > 120), two High domains, a High domain with amber vitals, or overall High for 3+ hours in a row during a simulation (ends as soon as urgency drops out of High)

  Staff load never changes the level; when it is high it adds a prioritization note to the staff message.
- **Status Halo** — The overall score sits inside a halo coloured by the current intervention level; it breathes slower when calm and faster as the ladder climbs (8 s → 2.4 s per breath; no motion when the viewer prefers reduced motion). Beside it, the three domain scores with their Medium/High thresholds.
- **Explainability Panel** — States the ladder rule that set the level, then draws the Overall score as one bar split into its contributing signals (exact additive contributions from the scoring model, so the segments add up to the score), with a legend, the 40/70 thresholds and a natural-language summary built from the same numbers.
- **24-Hour Simulation** — Animated walk-through of a full day with random drift, night patterns, and event generation. Every run is seeded: the seed is shown after a random day, and typing it back in replays that day exactly.
- **Scenario Presets** — Scripted one-day stories for demos, each walking the intervention ladder along a different path: *Sundowning evening* (cognitive → Level 4 at night), *UTI onset* (confusion + rising heart rate → Level 4, then recovery), *Withdrawn day* (loneliness, gentle prompts only) and *Restless night* (fall risk → Level 4 in the small hours). Each has a fixed seed so the demo plays the same way every time; stories play at 0.5 s per hour.
- **Optional LLM Messaging** — Toggle on adaptive, AI-generated resident and staff messages via any OpenAI-compatible API (OpenAI, Ollama, LM Studio). Falls back to deterministic templates when disabled.
- **SVG Charts** — Baseline vs Current bar chart and 24h risk trend lines with night-band shading.
- **Event Timeline** — Chronological feed of detected events with severity markers.

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
├── risk.ts                 # Risk scoring, urgency bands, explanation builder
├── intervention.ts         # Intervention level selection and template messages
├── simulation.ts           # Seeded 24-hour simulation: random-walk day or keyframed scenario
├── scenarios.ts            # Scenario presets (keyframed storylines) and interpolation
├── rng.ts                  # Seeded PRNG and seed parsing
├── escalation.test.ts      # Vitest coverage for scoring and the intervention ladder
├── chart.ts                # SVG chart renderers (comparison + timeline)
├── view.ts                 # View models: halo per level, explanation score-bar segments
├── engine/
│   └── llmMessaging.ts     # LLM controller (debounce, abort, OpenAI client)
├── style.css               # Page layout (imports tokens + components)
└── styles/
    ├── tokens.css           # Design tokens (colors, spacing, radii, shadows)
    └── components.css       # Reusable component styles
```

## LLM Configuration

1. Enable the **Adaptive Messages** toggle in the controls panel.
2. Enter your API key (stored in localStorage, never sent anywhere except the configured base URL).
3. Optionally change the base URL and model name for local inference servers.
4. Click **Test Connection** to verify.

Compatible with any OpenAI-compatible API endpoint.

## Disclaimer

Prototype for demonstration and research purposes only. Not a medical device.

---

(c) 2026 Murat Baturay
