# How AURA works, and its limits

AURA is a **prototype of the decision architecture** for ambient care. It shows how passive signals from a room, and optionally a wearable, can become graded, explainable, human-acknowledged responses. It is **not a medical device**. The scoring model is transparent and deliberately simple, so every decision can be traced by hand. Its weights and thresholds are illustrative, not fitted to outcome data.

The same content is available in the app under **How it works**. The numbers there are read from the code itself. A test checks that the formulas below match the code.

## The pipeline

1. **Signals.** Each hour: mobility stability, restlessness, speech clarity drift, social isolation, time of day and, if worn, heart rate and SpO2.
2. **The resident's usual.** Each resident has their own usual levels, variability, night-time habits and care-plan settings.
3. **Risk now.** Three areas are scored from 0 to 100: fall risk, cognitive concern and loneliness.
4. **Change from usual.** Each area is compared with the resident's own usual score at that hour. This change, not the absolute risk, drives the response.
5. **Ladder.** The urgency sets one of four levels: ambient cue, gentle prompt, staff soft alert or escalation. Absolute red flags put a floor under urgency, whatever the resident's normal.
6. **Explanation.** The urgency is split exactly into what rose above usual. The parts always add up to the score.
7. **Action and acknowledgement.** AURA speaks to the resident, adjusts the room and notifies staff. A staff alert waits to be acknowledged, with a timer.

## Inputs, and what would feed them in reality

| Input | What it stands for | A plausible real source |
|---|---|---|
| Mobility stability | How steady and able on their feet | Gait speed and sway from mmWave radar or depth sensors; sit-to-stand time |
| Restlessness | Movement and agitation, especially in bed | Bed and chair pressure sensors; radar motion at night |
| Speech clarity drift | Change in how they speak | Analysis of everyday speech (needs explicit consent) |
| Social isolation | Contact with others | Room visits, door sensors, calls, time in shared spaces |
| Time up at night | Out of bed at night | A bed-occupancy sensor. The prototype **infers** it from restlessness. |
| Heart rate, SpO2 | Vital signs | A wearable monitor, only where the resident has agreed to wear one |

In the simulator these are sliders, or they come from scripted stories and seeded random days. The hard problem of turning raw sensing into these features is **not** modelled here.

## The scoring

`z` is the distance from the resident's usual, in standard deviations.

```text
Time up at night = (restlessness − 25) ÷ 45, between 0 and 1; awake hours count as fully up
Exposure = 0.35 + 0.65 × time up
Fall risk = exposure × (0.35 × (100 − mobility) + 5 × z below usual mobility + 0.2 × restlessness + 3 × z above usual restlessness + 0.5 × heart-rate beats above 110 + 3 × SpO2 points below 92) + 18 × time up at night
Cognitive concern = 0.45 × speech drift + 4 × z above usual speech drift + 0.25 × restlessness at night
Activity = 0.3 × mobility + 0.2 × (100 − restlessness)
Loneliness = 0.5 × isolation + 4 × z above usual isolation + 0.3 × max(0, 50 − activity)
Each area is capped at 100; overall = worst area + 0.2 × second-worst
Change from usual (per area) = 1.5 × 100 × (now − usual) ÷ max(50, 100 − usual), and 0 when at or below usual
Bands: Low < 40 ≤ Medium < 70 ≤ High
```

**Why "change from usual".** A frail resident's normal is already risky. Scoring absolute risk would prompt them every hour, which is alarm fatigue. So their standing risk is shown as context (a tick on each bar), and the ladder responds to the change.

**Night-time fall risk** is compared with the resident's usual *when up as much as they are now*. A single bathroom trip is not an alarm. Being less steady than usual while up is. Hours in a row out of bed are handled by the red flags below.

### The ladder

- Level 1 · Ambient cue: urgency Low
- Level 2 · Gentle prompt to the resident: urgency Medium
- Level 3 · Staff soft alert: urgency High, or amber vitals
- Level 4 · Escalate: red vitals, two areas High, one area High with amber vitals, or urgency High for 3+ hours in a row

### Red flags

- Vitals outside the resident's care-plan targets: amber lifts urgency to at least 40, red to at least 70
- Up at night with a care-plan bed-exit alert: urgency at least 70
- Up at night and very unsteady (fall risk ≥ 85): urgency at least 70
- 2+ hours in a row out of bed at night: urgency at least 40
- 3+ hours in a row out of bed at night: urgency at least 70
- Staff workload never changes the level; it only adds a note to the staff message

### The residents

| Resident | Summary | Usual (mobility · restlessness · speech · isolation) | Wearables | Care-plan SpO2 targets | Bed-exit alert | Wake-ups on random days |
|---|---|---|---|---|---|---|
| Eleanor, 82 | Independent and steady; sleeps well. | 70 · 25 · 20 · 30 | no | SpO2 amber < 92, red < 90 | no | 8% of night hours |
| Walter, 88 | Frail and unsteady, history of falls; often up at night. | 42 · 35 · 22 · 35 | no | SpO2 amber < 92, red < 90 | yes | 22% of night hours |
| Margaret, 79 | Early dementia; more restless in the evening. | 62 · 32 · 45 · 30 | no | SpO2 amber < 92, red < 90 | yes | 16% of night hours |
| Joseph, 85 | Recently widowed and withdrawn; COPD, wears a monitor. | 58 · 20 · 18 · 62 | yes | SpO2 amber < 88, red < 85 | no | 8% of night hours |

## Illustrative versus structural

| Illustrative (placeholders to be fitted or agreed) | Structural (the design being demonstrated) |
|---|---|
| Every weight and threshold above | The pipeline: signals → usual → risk → change → ladder → explanation → action |
| The four residents' usual levels and care plans | Responding to change from each resident's own normal |
| Noise, wake-up rates and "off" episodes on random days | Absolute red flags as floors that no normal can hide |
| The scripted stories | Explanations that are exact: the parts add up to the score |
| Message wording | A human acknowledges every staff alert |

## Limits

- **Baselines are fixed, not learned.** A real system would learn each resident's usual from several weeks of data and update it slowly.
- **Nothing is calibrated to outcomes.** There are no measured false-alarm rates, detection rates or alerts per resident per night. Until there are, the scores are indices, not probabilities.
- **Inputs are simulated.** Restlessness stands in for being out of bed; a bed-occupancy sensor would measure it directly.
- **Hourly steps.** Falls happen in seconds, delirium develops over hours to days, and isolation over weeks. One hourly loop simplifies all three.
- **One ladder for every concern.** Loneliness and fall risk escalate to the same staff. A real deployment would route each concern to the right person: activities, family, nursing or night staff.
- **Stories are scripted.** They demonstrate behaviour, not accuracy.
- **AI-generated messages** to a resident who may be confused need clinical review and strict guardrails. Deterministic templates are the default.
- **Privacy and consent.** Continuous sensing and speech analysis need explicit consent, including from residents with cognitive impairment, often through a representative.

## What it would take to make it real

1. **Data:** sensor streams paired with outcomes such as falls, delirium episodes, UTIs and hospital transfers.
2. **Learned baselines** per resident, over two to four weeks, with slow adaptation.
3. **Calibration:** fit the weights to those outcomes, and report sensitivity, positive predictive value and alerts per resident-night.
4. **Routing** of each concern to the right responder.
5. **Clinical governance:** thresholds, care-plan flags and message content agreed with clinicians, with an audit trail.
6. **Privacy by design:** on-device processing where possible, data minimisation and clear consent.
7. **Regulation:** as a decision-support tool it would likely be regulated as software as a medical device.
