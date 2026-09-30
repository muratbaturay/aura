# Residents & Change-From-Normal Alerts — Design

**Date:** 2026-09-30
**Status:** Approved in conversation ("go ahead"). Builds on branch `feat/sleep-and-exposure`.

## Goal

Give AURA a cast of residents with different normals, and make alerts respond to **change from each resident's own normal** rather than absolute risk, so a frail resident is not prompted every hour and "personal baseline" genuinely matters.

## Decisions

| Topic | Decision |
|---|---|
| Alert basis | Change from the resident's usual level at that hour; absolute red flags still escalate |
| Stories | Each belongs to a resident: Sundowning → Margaret, Restless night → Walter, Withdrawn day → Joseph, UTI onset → Eleanor |
| Scores in text | Indices, never "%" |

## Residents (`src/residents.ts`)

| id | Name | Usual (mobility / restlessness / speech / isolation) | Wearables | Night wake chance | Contact |
|---|---|---|---|---|---|
| eleanor | Eleanor, 82 | 70 / 25 / 20 / 30 | off | 0.08 | Martha |
| walter | Walter, 88 | 42 / 35 / 22 / 35 | off | 0.22 | his daughter Ruth |
| margaret | Margaret, 79 | 62 / 32 / 45 / 30 (+10 restlessness 17–21) | off | 0.14 | her son David |
| joseph | Joseph, 85 | 58 / 20 / 18 / 62 | on (HR 84, SpO2 93) | 0.08 | his friend Samuel |

Each resident has a `ResidentBaseline` (means = usual levels, own variances; sleep 22–06 for all), a one-line summary, and a standing-risk note.

`usualStateAt(resident, hour)`: by day the usual levels (Margaret's evening bump 17–21); at night asleep (restlessness 15).

## Scoring (`src/assessment.ts`)

- **Standing risk** = `computeRisks` (unchanged).
- **Usual risk** = `computeRisks` of `usualStateAt(resident, hour)`.
- **Alert score per domain** = `100 × max(0, now − usual) / (100 − usual)`.
- **Overall alert** = worst alert + 0.2 × second-worst; floors: vitals red 70 / amber 40 (unchanged, absolute); **up at night and very unsteady** (standing fall ≥ 85 with time up ≥ 0.5 at night) → 70. Clamped to 100.
- **Ladder** = `selectIntervention(state, alert, highStreak, resident)`; unchanged rules, fed alert scores.
- **Explanation** = per-signal contribution to the alert: for each domain, (cap-scaled term now − cap-scaled term usual); only positive changes are shown, scaled so they sum to the domain's excess; × headroom factor; worst ×1, second ×0.2; floors as their own factor; overall cap scaling. Factor points sum exactly to the overall alert. Narrative: "… above {name}'s usual".

## Simulation

- `simulate24h(resident, initialState, { rng, scenario? })`. Snapshots carry `risks` (standing), `alert`, `intervention` (from alert).
- Random day: drifts to the start state (the sliders, which load the resident's usual); night wake chance from the resident.
- **Off episodes:** with probability 0.5 a random day contains one 4–8 hour episode of one kind — restless (+30 restlessness), confused (+30 speech drift), withdrawn (+30 isolation), unsteady (−25 mobility) — starting 08–18 (restless: may start at 22–02).
- Events use **alert** bands; details show "now (usual N)".
- Stories start from their resident's usual; keyframes re-tuned so their target levels hold for 200 seeds.

## Interface

- Header: resident name becomes a switcher (popover of the four, with summary). Switching ends any run and loads the resident's usual.
- Status card: area bars show standing value with a tick at usual; text "55 · usual 50"; band label = alert band. Halo, ladder = alert.
- Studio: story cards name their resident; choosing a story selects the resident. Reset → "Reset to usual".
- Messages and LLM context use the selected resident (name, age, contact).
- Day-log details and staff messages: no "%".

## Testing

Residents data; `usualStateAt`; alert scoring (Walter at usual → Level 1; Eleanor at Walter's usual → elevated; red flags absolute; explanation sums); random days per resident not mostly empty (Eleanor < 35 % empty, others < 20 %); stories at 200 seeds; jsdom: switching resident updates name/levels and ends a run.

## Out of scope

Learned multi-day baselines, limits page, per-domain routing.
