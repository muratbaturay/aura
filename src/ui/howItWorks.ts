import { formulaLines, ladderLines, redFlagLines, residentRows } from '../howItWorks';

const DOC_URL = 'https://github.com/muratbaturay/aura/blob/main/docs/how-it-works.md';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (lines: string[]) => `<ul class="how-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;

/** The "How it works" panel: prose plus the model's own formulas, rules and residents. */
export function renderHowItWorks(): string {
  return `
    <section class="how-section">
      <p class="how-lead">AURA is a <strong>prototype of the decision architecture</strong> for ambient care: how passive room
      signals, and optionally a wearable, become graded, explainable, human-acknowledged responses. It is not a medical
      device. The model is deliberately simple so every decision can be traced by hand. Its weights are illustrative, not fitted to outcome data.</p>
    </section>

    <section class="how-section">
      <h3>The pipeline</h3>
      <ol class="how-steps">
        <li><strong>Signals</strong> each hour: mobility, restlessness, speech drift, isolation, time of day, optional vitals.</li>
        <li><strong>The resident's usual:</strong> their own normal levels, night habits and care plan.</li>
        <li><strong>Risk now</strong> in three areas: fall risk, cognitive concern, loneliness (0–100).</li>
        <li><strong>Change from usual</strong> per area. This, not absolute risk, drives the response.</li>
        <li><strong>Ladder:</strong> four levels, with absolute red flags as floors.</li>
        <li><strong>Explanation:</strong> the urgency split exactly into what rose above usual.</li>
        <li><strong>Action and acknowledgement:</strong> resident, room and staff, with a staff acknowledgement.</li>
      </ol>
    </section>

    <section class="how-section">
      <h3>Inputs, and what would feed them in reality</h3>
      <table class="how-table">
        <thead><tr><th>Input</th><th>A plausible real source</th></tr></thead>
        <tbody>
          <tr><td>Mobility stability</td><td>Gait speed and sway (mmWave radar or depth sensor); sit-to-stand time</td></tr>
          <tr><td>Restlessness</td><td>Bed and chair pressure sensors; radar motion at night</td></tr>
          <tr><td>Speech clarity drift</td><td>Analysis of everyday speech (needs explicit consent)</td></tr>
          <tr><td>Social isolation</td><td>Room visits, door sensors, calls, time in shared spaces</td></tr>
          <tr><td>Time up at night</td><td>A bed-occupancy sensor (the prototype infers it from restlessness)</td></tr>
          <tr><td>Heart rate, SpO2</td><td>A wearable monitor, where the resident agrees to wear one</td></tr>
        </tbody>
      </table>
    </section>

    <section class="how-section">
      <h3>The scoring</h3>
      <p class="how-note">z = distance from the resident's usual, in standard deviations. Every number below is read from the running code.</p>
      <pre class="how-formulas">${formulaLines().map(esc).join('\n')}</pre>
      <p>Night-time fall risk is compared with the resident's usual <em>when up as much as they are now</em>. A single bathroom trip is
      not an alarm; being less steady than usual while up is.</p>
    </section>

    <section class="how-section">
      <h3>The ladder</h3>
      ${list(ladderLines())}
      <h3>Red flags (floors under urgency)</h3>
      ${list(redFlagLines())}
    </section>

    <section class="how-section">
      <h3>The residents</h3>
      <table class="how-table">
        <thead><tr><th>Resident</th><th>Usual (mob · rest · speech · isol)</th><th>Care-plan SpO2</th><th>Bed-exit alert</th></tr></thead>
        <tbody>${residentRows().map(r => `
          <tr><td><strong>${esc(r.name)}, ${r.age}</strong><br><span class="how-note">${esc(r.summary)}</span></td>
          <td class="mono">${r.usual}</td><td>${esc(r.vitals)}</td><td>${r.bedExitAlert}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="how-section">
      <h3>Illustrative versus structural</h3>
      <p><strong>Illustrative</strong> (to be fitted or agreed): every weight and threshold, the residents' profiles and care plans,
      random-day noise and episodes, the scripted stories, message wording.</p>
      <p><strong>Structural</strong> (what is being demonstrated): the pipeline, change from each resident's own normal, red flags
      as floors, exact explanations, and a human acknowledging every staff alert.</p>
    </section>

    <section class="how-section">
      <h3>Limits</h3>
      <ul class="how-list">
        <li>Baselines are fixed per resident, not learned from weeks of data.</li>
        <li>Nothing is calibrated to outcomes: no measured false-alarm or detection rates yet. Scores are indices, not probabilities.</li>
        <li>Inputs are simulated; restlessness stands in for being out of bed.</li>
        <li>Hourly steps simplify events that unfold in seconds (falls), hours to days (delirium) or weeks (isolation).</li>
        <li>One ladder serves every concern; a real deployment would route each concern to the right person.</li>
        <li>Stories are scripted: they show behaviour, not accuracy.</li>
        <li>AI-generated messages to a possibly confused resident need clinical review and guardrails.</li>
        <li>Continuous sensing and speech analysis need explicit consent, often through a representative.</li>
      </ul>
    </section>

    <section class="how-section">
      <h3>What it would take to make it real</h3>
      <ol class="how-steps">
        <li>Sensor data paired with outcomes (falls, delirium, UTIs, transfers).</li>
        <li>Baselines learned per resident over two to four weeks.</li>
        <li>Weights fitted to outcomes, reporting sensitivity, positive predictive value and alerts per resident-night.</li>
        <li>Routing each concern to the right responder.</li>
        <li>Clinical governance of thresholds, care plans and messages.</li>
        <li>Privacy by design and clear consent.</li>
        <li>Regulation: likely software as a medical device.</li>
      </ol>
      <p class="how-note">The full version is <a href="${DOC_URL}" target="_blank" rel="noopener">docs/how-it-works.md</a> on GitHub.</p>
    </section>`;
}
