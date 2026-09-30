# Residents & Change-From-Normal Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four residents with their own normals; alerts driven by change from that normal; stories bound to residents; random days with off-episodes.

**Architecture:** `computeRisks` stays as the standing (absolute) layer. A new `assessment.ts` computes the resident's usual risk at the hour and the alert scores and explanation on top. `simulate24h` takes a resident. The ladder is fed alert scores.

**Tech Stack:** TypeScript, Vite 7, Vitest 5 (+ jsdom for wiring tests).

**Spec:** `docs/superpowers/specs/2026-09-30-residents-design.md`

## Global Constraints

- Alert per domain = `100 × max(0, now − usual) / (100 − usual)`; overall = worst + 0.2 × second; floors: vitals red 70 / amber 40; up-at-night-and-very-unsteady (standing fall ≥ 85, time up ≥ 0.5, night) 70.
- Residents: eleanor, walter, margaret, joseph with the usual levels, wake chances and contacts in the spec table.
- Stories: sundowning → margaret, restless-night → walter, withdrawn → joseph, uti → eleanor; target levels unchanged.
- Off episodes: probability 0.5 per random day, 4–8 h, one kind.
- No "%" after score values in any generated text.

## Review Focus

1. A resident switched mid-run or while paused: the run ends, levels load, nothing from the previous resident lingers (chips, lanes, ack, LLM text). (Task 4 jsdom test.)
2. Explanation must still sum exactly to the overall alert, including when some signals are below usual while others are above. (Task 2 property test.)
3. Walter's very frequent night wake-ups: alert must not sit at Level 3+ every night hour unless he is really unsteady (the ≥ 85 flag). (Task 3 distribution test.)
4. Margaret's evening bump: her usual evening restlessness must not by itself trigger alerts. (Task 2 test at 19:00.)
5. Joseph's usual SpO2 93 is amber-adjacent: amber/red vitals flags are absolute by design; confirm his usual day does not flag (93 ≥ 92) but a dip to 91 does. (Task 2 test.)

---

### Task 1: Residents and usual state

**Files:** Create `src/residents.ts`, `src/residents.test.ts`.

**Produces:** `Resident` `{ id, name, age, summary, contact, baseline: ResidentBaseline, usual: CurrentState, nightWake: number, eveningRestlessness: number }`; `RESIDENTS: Resident[]`; `residentById(id)`; `usualStateAt(resident, hour): CurrentState`; `ELEANOR`.

- [ ] Tests: four residents in order eleanor/walter/margaret/joseph; baseline means equal usual levels; `usualStateAt` → by day the usual levels with `timeOfDay` = hour; Margaret +10 restlessness at 17–21 only; at night restlessness 15 for everyone, other signals usual; Joseph wearables on with HR 84 / SpO2 93.
- [ ] Run → FAIL; implement; run → PASS; commit.

### Task 2: Assessment (alert scores + explanation)

**Files:** Create `src/assessment.ts`, `src/assessment.test.ts`. Modify `src/risk.ts` (export cap-scaled domain contributions helper), `src/intervention.ts` (optional resident for contact name).

**Produces:** `assess(state, resident): { standing: RiskScores; usual: RiskScores; alert: RiskScores; explanation: ExplanationOutput }`; `selectIntervention(state, risks, highStreak, resident?)`.

- [ ] Tests:
  - Each resident at `usualStateAt(r, h)` for h in {3, 10, 19} → all domain alerts 0, overall alert 0 → Level 1.
  - Eleanor with Walter's usual levels at 14:00 → overall alert ≥ 40.
  - Walter at 14:00 with mobility 30 (below his 42) → fall alert > 0; with mobility 42 → 0.
  - Margaret at 19:00 at her usual (evening bump) → overall alert 0.
  - Joseph usual day → no vitals flag, alert 0; SpO2 91 → amber → overall ≥ 40.
  - Walter up at 03:00 with restlessness 85, mobility 30 → standing fall ≥ 85 → overall ≥ 70 and a factor naming being up and unsteady.
  - Explanation factor points sum to overall alert for ~20 mixed states across residents (some signals below usual, some above), all > 0.
  - Staff/resident messages use the resident's name/contact; no "%" after numbers.
- [ ] Run → FAIL; implement; run → PASS; full suite; commit.

### Task 3: Simulation with residents, off-episodes and re-tuned stories

**Files:** Modify `src/simulation.ts`, `src/scenarios.ts` (+ `residentId`), `src/types.ts` (`SimulationSnapshot.alert`), all tests calling `simulate24h`.

- [ ] Signature `simulate24h(resident, initialState, { rng, scenario? })`; scenario starts from `scenario resident.usual`; ladder and events from `assess`; snapshot `risks` = standing, `alert` = alert; events' details use "N (usual M)" and no "%".
- [ ] Random-day wake chance = `resident.nightWake`; off-episode per spec.
- [ ] Tests: per resident over 150 seeds — Eleanor < 35 % empty days, others < 20 %; Walter night hours at Level 3+ < 40 %; stories bound (`residentId`) and target tests (200 seeds) pass after keyframe re-tune; existing sleep/event tests updated to the resident API.
- [ ] Commit.

### Task 4: Interface

**Files:** Modify `src/ui/template.ts`, `src/main.ts`, `src/style.css`, `src/engine/llmMessaging.ts` (unchanged API; context from resident).

- [ ] Resident switcher in the header (button + popover list; Esc / outside click close; `aria-expanded`); switching ends a run, loads usual levels, re-renders name/sub.
- [ ] Status card: domain rows show standing value, "usual N", tick at usual; band = alert band; halo/ladder from alert.
- [ ] Explanation panel from `assess().explanation`; doing card "Said to {name}"; Reset → "Reset to usual".
- [ ] Studio story cards show the resident; selecting a story selects the resident; arcs computed with the story's resident.
- [ ] jsdom tests: switching resident changes the header name and the mobility slider to the resident's usual; switching mid-run hides the playback bar and chip.
- [ ] Browser check; commit.

### Task 5: Docs and final review

- [ ] README: residents, change-from-normal alerts, indices not percentages.
- [ ] `npm test && npm run build`; final whole-branch review; fix Critical/Important with failing tests first.
