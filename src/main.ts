import type {
  CurrentState, TimelineEvent, SimulationSnapshot,
  LLMGeneratedMessages, LLMConfig, LLMMessageContext, ResidentProfile,
  EnrichedInterventionOutput, MessageSource, InterventionOutput,
  RiskScores, ExplanationOutput,
} from './types';
import { DEFAULT_BASELINE, defaultState, computeDeviations } from './baseline';
import { computeRisks, urgencyBand, buildExplanation } from './risk';
import { selectIntervention } from './intervention';
import { simulate24h, startStateFor } from './simulation';
import { createRng, randomSeed, parseSeed } from './rng';
import { SCENARIOS } from './scenarios';
import { renderComparisonChart, renderTimelineChart } from './chart';
import {
  loadLLMConfig, saveLLMConfig, isLLMAvailable,
  createLLMController,
} from './engine/llmMessaging';
import type { LLMStatus } from './engine/llmMessaging';
import './style.css';

// ── State ───────────────────────────────────────────────────
let state: CurrentState = defaultState();
let highStreak = 0;
let timelineEvents: TimelineEvent[] = [];
let simSnapshots: SimulationSnapshot[] = [];
let llmConfig: LLMConfig = loadLLMConfig();
let lastLLMMessages: LLMGeneratedMessages | null = null;
let simRunning = false;
let runId = 0; // bumped by each run and by Reset; a playback loop stops when its id is stale
let lastRun: { seed: number; start: CurrentState } | null = null; // for exact random-day replay

// Cached outputs for LLM panel re-renders without full update()
let lastIntervention: InterventionOutput | null = null;
let lastExplanation: ExplanationOutput | null = null;
let lastRisks: RiskScores | null = null;

const residentProfile: ResidentProfile = {
  age: 82,
  name: 'Eleanor',
  mobilityBaseline: DEFAULT_BASELINE.mobilityMean,
  cognitiveConcernLevel: 'Low',
};

// ── LLM Controller (single instance) ────────────────────────
const llm = createLLMController(600);

// ── Context Signature (meaningful-change gating) ────────────
let prevSignature = '';

function computeContextSignature(
  intervention: InterventionOutput,
  risks: RiskScores,
  explanation: ExplanationOutput,
  events: TimelineEvent[]
): string {
  const urgency = urgencyBand(risks.overall);
  const top2 = explanation.topFactors.slice(0, 2).map(f => f.factor).join(',');

  // Last significant event
  const lastSig = [...events]
    .reverse()
    .find(e => e.urgency !== 'Low');
  const lastEventKey = lastSig
    ? `${lastSig.label}|${lastSig.urgency}`
    : 'none';

  return `${intervention.level}|${urgency}|${top2}|${lastEventKey}`;
}

// ── DOM Setup ───────────────────────────────────────────────
document.querySelector<HTMLDivElement>('#app')!.innerHTML = buildHTML();

// Bind scenario sliders
bindSlider('time', 0, 24, 0.5, state.timeOfDay, v => { state.timeOfDay = v; });
bindSlider('mobility', 0, 100, 1, state.mobility, v => { state.mobility = v; });
bindSlider('restlessness', 0, 100, 1, state.restlessness, v => { state.restlessness = v; });
bindSlider('speech', 0, 100, 1, state.speechDrift, v => { state.speechDrift = v; });
bindSlider('social', 0, 100, 1, state.socialIsolation, v => { state.socialIsolation = v; });
bindSlider('staffLoad', 0, 100, 1, state.staffLoad, v => { state.staffLoad = v; });
bindSlider('hr', 40, 140, 1, state.heartRate, v => { state.heartRate = v; });
bindSlider('spo2', 85, 100, 0.5, state.spO2, v => { state.spO2 = v; });

// Wearables toggle
const wearToggle = document.getElementById('wearToggle') as HTMLInputElement;
wearToggle.checked = state.useWearables;
wearToggle.addEventListener('change', () => {
  state.useWearables = wearToggle.checked;
  highStreak = 0;
  syncWearablesUI();
  update();
});

// Action buttons
document.getElementById('btnSimulate')!.addEventListener('click', runSimulation);
document.getElementById('btnReset')!.addEventListener('click', resetAll);
document.getElementById('btnRandomize')!.addEventListener('click', randomize);

// Scenario + seed controls
const scenarioSelect = document.getElementById('scenarioSelect') as HTMLSelectElement;
const seedInput = document.getElementById('seedInput') as HTMLInputElement;
setupScenarioUI();

// ── LLM Config UI Binding ───────────────────────────────────
setupLLMConfigUI();

update();

// ── LLM Config UI ───────────────────────────────────────────
function setupLLMConfigUI() {
  const toggle = document.getElementById('llmToggle') as HTMLInputElement;
  const configBody = document.getElementById('llmConfigBody')!;
  const apiKeyInput = document.getElementById('llmApiKey') as HTMLInputElement;
  const baseUrlInput = document.getElementById('llmBaseUrl') as HTMLInputElement;
  const modelInput = document.getElementById('llmModel') as HTMLInputElement;
  const testBtn = document.getElementById('btnTestLLM') as HTMLButtonElement;
  const statusEl = document.getElementById('llmStatus')!;
  const refreshBtn = document.getElementById('btnRefreshLLM') as HTMLButtonElement;

  // Init from stored config
  toggle.checked = llmConfig.enabled;
  apiKeyInput.value = llmConfig.apiKey;
  baseUrlInput.value = llmConfig.baseUrl;
  modelInput.value = llmConfig.model;
  configBody.classList.toggle('hidden', !llmConfig.enabled);
  updateLLMStatusBadge();
  updateRefreshBtnVisibility();

  toggle.addEventListener('change', () => {
    llmConfig.enabled = toggle.checked;
    configBody.classList.toggle('hidden', !toggle.checked);
    saveLLMConfig(llmConfig);
    if (!toggle.checked) {
      stopLLMWork();
      lastLLMMessages = null;
    }
    updateLLMStatusBadge();
    updateRefreshBtnVisibility();
    update();
  });

  apiKeyInput.addEventListener('change', () => {
    llmConfig.apiKey = apiKeyInput.value.trim();
    saveLLMConfig(llmConfig);
    updateLLMStatusBadge();
    updateRefreshBtnVisibility();
  });

  baseUrlInput.addEventListener('change', () => {
    llmConfig.baseUrl = baseUrlInput.value.trim();
    saveLLMConfig(llmConfig);
  });

  modelInput.addEventListener('change', () => {
    llmConfig.model = modelInput.value.trim();
    saveLLMConfig(llmConfig);
  });

  testBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Testing connection\u2026';
    statusEl.className = 'llm-status testing';
    try {
      const url = `${llmConfig.baseUrl.replace(/\/+$/, '')}/models`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${llmConfig.apiKey}` },
      });
      if (res.ok) {
        statusEl.textContent = 'Connected';
        statusEl.className = 'llm-status connected';
      } else {
        statusEl.textContent = `Error ${res.status}`;
        statusEl.className = 'llm-status error';
      }
    } catch (err) {
      statusEl.textContent = `Failed: ${(err as Error).message.slice(0, 40)}`;
      statusEl.className = 'llm-status error';
    }
  });

  refreshBtn.addEventListener('click', () => {
    forceRefreshLLM();
  });
}

function updateLLMStatusBadge() {
  const badge = document.getElementById('llmActiveBadge')!;
  if (isLLMAvailable(llmConfig)) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function updateRefreshBtnVisibility() {
  const btn = document.getElementById('btnRefreshLLM')!;
  btn.classList.toggle('hidden', !isLLMAvailable(llmConfig));
}

// ── LLM Status Display ──────────────────────────────────────
function setLLMCallStatus(status: LLMStatus) {
  const el = document.getElementById('llmCallStatus');
  if (!el) return;

  const labels: Record<LLMStatus, string> = {
    idle: 'idle',
    generating: 'generating\u2026',
    error: 'error',
  };

  el.textContent = `LLM: ${labels[status]}`;
  el.className = `llm-call-status llm-call-${status}`;

  // Dev call counter
  const counter = document.getElementById('llmCallCount');
  if (counter) {
    counter.textContent = `calls: ${llm.callCount()}`;
  }
}

// ── Stop all LLM work ───────────────────────────────────────
function stopLLMWork() {
  llm.stopAll();
  setLLMCallStatus('idle');
}

// ── Build LLM Context ───────────────────────────────────────
function buildLLMContext(
  risks: RiskScores,
  interventionLevel: 1 | 2 | 3 | 4,
  topFactors: string[]
): LLMMessageContext {
  residentProfile.cognitiveConcernLevel = urgencyBand(risks.cognitive);

  return {
    residentProfile,
    riskScores: risks,
    timeOfDay: state.timeOfDay,
    interventionLevel,
    topContributingFactors: topFactors,
    staffLoad: state.staffLoad,
    useWearables: state.useWearables,
    heartRate: state.useWearables ? state.heartRate : undefined,
    spO2: state.useWearables ? state.spO2 : undefined,
  };
}

// ── Meaningful-change gated LLM trigger ─────────────────────
function maybeRequestLLM(
  intervention: InterventionOutput,
  risks: RiskScores,
  explanation: ExplanationOutput,
) {
  // Gate: skip during simulation, when LLM off, or level too low
  if (simRunning) return;
  if (!isLLMAvailable(llmConfig)) return;
  if (intervention.level < 2) {
    // Level 1 → no LLM needed, stop any pending work
    stopLLMWork();
    lastLLMMessages = null;
    return;
  }

  // Compute signature and check for meaningful change
  const sig = computeContextSignature(intervention, risks, explanation, timelineEvents);
  if (sig === prevSignature) return; // No change → skip
  prevSignature = sig;

  const topFactors = explanation.topFactors.map(f => f.factor);
  const ctx = buildLLMContext(risks, intervention.level, topFactors);
  setLLMCallStatus('generating');

  llm.request(ctx, llmConfig, handleLLMResult, handleLLMError);
}

// Force refresh: bypasses signature check and debounce
function forceRefreshLLM() {
  if (!isLLMAvailable(llmConfig)) return;
  if (!lastIntervention || !lastRisks || !lastExplanation) return;
  if (lastIntervention.level < 2) return;

  prevSignature = ''; // Reset so next auto-check also works
  const topFactors = lastExplanation.topFactors.map(f => f.factor);
  const ctx = buildLLMContext(lastRisks, lastIntervention.level, topFactors);
  setLLMCallStatus('generating');

  llm.forceRequest(ctx, llmConfig, handleLLMResult, handleLLMError);
}

// LLM result/error handlers — re-render panels WITHOUT calling update()
function handleLLMResult(msgs: LLMGeneratedMessages) {
  lastLLMMessages = msgs;
  setLLMCallStatus('idle');
  rerenderMessagePanels();
}

function handleLLMError(err: Error) {
  // Keep last successful messages on error (don't null them out)
  setLLMCallStatus('error');
  renderLLMErrorState(err.message);
}

/** Re-render only the intervention + explanation panels with LLM data */
function rerenderMessagePanels() {
  if (!lastIntervention || !lastExplanation) return;

  const source: MessageSource = (lastLLMMessages && isLLMAvailable(llmConfig)) ? 'llm' : 'template';
  const enriched: EnrichedInterventionOutput = {
    ...lastIntervention,
    source,
    llmExplanation: lastLLMMessages?.explanationText ?? undefined,
  };
  if (source === 'llm' && lastLLMMessages) {
    if (lastLLMMessages.residentMessage !== null) {
      enriched.residentMessage = lastLLMMessages.residentMessage;
    }
    if (lastLLMMessages.staffMessage !== null) {
      enriched.staffMessage = lastLLMMessages.staffMessage;
    }
  }

  renderIntervention(enriched);
  renderExplanation(lastExplanation, enriched);
}

// ── Core Update (deterministic only — no LLM calls here) ───
function update() {
  const devs = computeDeviations(DEFAULT_BASELINE, state);
  const risks = computeRisks(state, devs, DEFAULT_BASELINE);
  const intervention = selectIntervention(state, risks, highStreak);
  const explanation = buildExplanation(state, devs, risks, DEFAULT_BASELINE);
  const overallBand = urgencyBand(risks.overall);

  // Cache for LLM panel re-renders
  lastIntervention = intervention;
  lastExplanation = explanation;
  lastRisks = risks;

  // Risk cards
  setRiskCard('fallRisk', 'Fall Risk', risks.fall);
  setRiskCard('cogRisk', 'Cognitive Concern', risks.cognitive);
  setRiskCard('loneRisk', 'Loneliness Risk', risks.loneliness);
  setOverallCard(risks.overall, overallBand);

  // Determine message source and content
  const source: MessageSource = (lastLLMMessages && isLLMAvailable(llmConfig)) ? 'llm' : 'template';

  const enriched: EnrichedInterventionOutput = {
    ...intervention,
    source,
    llmExplanation: lastLLMMessages?.explanationText ?? undefined,
  };

  if (source === 'llm' && lastLLMMessages) {
    if (lastLLMMessages.residentMessage !== null) {
      enriched.residentMessage = lastLLMMessages.residentMessage;
    }
    if (lastLLMMessages.staffMessage !== null) {
      enriched.staffMessage = lastLLMMessages.staffMessage;
    }
  }

  renderIntervention(enriched);
  renderExplanation(explanation, enriched);

  // Charts
  renderComparisonChart(document.getElementById('comparisonChart')!, DEFAULT_BASELINE, state);
  renderTimelineChart(document.getElementById('timelineChart')!, simSnapshots);

  // Event feed
  renderEventFeed();

  // LLM: gated trigger (no call during sim, no recursive loop)
  maybeRequestLLM(intervention, risks, explanation);
}

function renderIntervention(intervention: EnrichedInterventionOutput) {
  const intEl = document.getElementById('interventionContent')!;

  const sourceBadge = intervention.source === 'llm'
    ? '<span class="source-badge llm-badge">AI-Generated</span>'
    : '<span class="source-badge template-badge">Template</span>';

  const isGenerating = llm.status() === 'generating';
  const loadingIndicator = isGenerating
    ? '<span class="llm-loading-dot"></span>'
    : '';

  // Step indicator: 4 pills showing level progression
  const steps = [1, 2, 3, 4].map(i => {
    let cls = 'int-step';
    if (i <= intervention.level) {
      cls += ' filled';
      if (i >= 3) cls += ' warn';
      if (i >= 4) cls += ' danger';
    }
    return `<div class="${cls}"></div>`;
  }).join('');

  intEl.innerHTML = `
    <div class="int-level level-${intervention.level}">
      <span class="level-badge">Level ${intervention.level}</span>
      <div class="int-steps">${steps}</div>
      <span class="level-label">${intervention.levelLabel}</span>
      ${sourceBadge}
      ${loadingIndicator}
    </div>
    ${intervention.residentMessage ? `<div class="int-msg resident"><span class="msg-tag">To Resident</span><p>${escapeHtml(intervention.residentMessage)}</p></div>` : ''}
    ${intervention.staffMessage ? `<div class="int-msg staff"><span class="msg-tag">To Staff</span><p>${escapeHtml(intervention.staffMessage)}</p></div>` : ''}
    <div class="int-env"><span class="msg-tag">Environment</span><p>${intervention.environmentalCue}</p></div>
  `;
}

function renderExplanation(
  explanation: ExplanationOutput,
  intervention: EnrichedInterventionOutput,
) {
  const expEl = document.getElementById('explanationContent')!;
  // Bar length = points on the 0–100 score scale
  const factorsHTML = explanation.topFactors.map(f =>
    `<div class="factor-row">
      <span class="factor-name">${escapeHtml(f.factor)}</span>
      <div class="factor-bar-bg"><div class="factor-bar" style="width:${Math.min(100, f.points)}%"></div></div>
      <span class="factor-val">+${Math.round(f.points)}</span>
    </div>`
  ).join('');
  const shownPoints = explanation.topFactors.reduce((sum, f) => sum + f.points, 0);
  const totalPoints = explanation.factors.reduce((sum, f) => sum + f.points, 0);
  const summaryHTML = explanation.factors.length > 0
    ? `<p class="factors-summary">Top ${explanation.topFactors.length} of ${explanation.factors.length} factors · ${Math.round(shownPoints)} of ${Math.round(totalPoints)} points</p>`
    : '';

  const narrativeText = intervention.llmExplanation ?? explanation.narrative;
  const narrativeSource = intervention.llmExplanation
    ? '<span class="source-badge llm-badge narrative-badge">AI-Generated</span>'
    : '';

  expEl.innerHTML = `
    <p class="decision-trigger">${escapeHtml(intervention.trigger)}</p>
    <div class="factors">${factorsHTML}</div>
    ${summaryHTML}
    <div class="narrative-wrapper">
      ${narrativeSource}
      <p class="narrative">${escapeHtml(narrativeText)}</p>
    </div>
  `;
}

function renderLLMErrorState(msg: string) {
  const intEl = document.getElementById('interventionContent');
  if (intEl) {
    const existing = intEl.querySelector('.llm-error');
    if (existing) existing.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'llm-error';
    errDiv.textContent = `LLM unavailable: ${msg.slice(0, 80)}. Using template fallback.`;
    intEl.prepend(errDiv);
  }
}

function setRiskCard(id: string, label: string, score: number) {
  const band = urgencyBand(score);
  const el = document.getElementById(id)!;
  el.innerHTML = `
    <div class="risk-label">${label}</div>
    <div class="risk-score">${Math.round(score)}</div>
    <div class="risk-band band-${band.toLowerCase()}">${band}</div>
  `;
  el.className = `risk-card band-border-${band.toLowerCase()}`;
}

function setOverallCard(score: number, band: string) {
  const el = document.getElementById('overallRisk')!;
  el.innerHTML = `
    <div class="risk-label">Overall Urgency</div>
    <div class="risk-score overall-score">${Math.round(score)}</div>
    <div class="risk-band band-${band.toLowerCase()}">${band}</div>
  `;
  el.className = `risk-card overall band-border-${band.toLowerCase()}`;
}

function renderEventFeed() {
  const feed = document.getElementById('eventFeed')!;
  const last10 = timelineEvents.slice(-10).reverse();
  if (last10.length === 0) {
    feed.innerHTML = '<p class="empty-feed">Events will appear during simulation.</p>';
    return;
  }
  feed.innerHTML = last10.map(e => `
    <div class="event-item event-${e.urgency.toLowerCase()}">
      <span class="event-time">${e.time.toString().padStart(2, '0')}:00</span>
      <span class="event-label">${e.label}</span>
      <span class="event-badge badge-${e.urgency.toLowerCase()}">${e.urgency}</span>
      <p class="event-detail">${e.detail}</p>
    </div>
  `).join('');
}

// ── Simulation ──────────────────────────────────────────────
function setupScenarioUI() {
  scenarioSelect.innerHTML = '<option value="">Random day</option>' +
    SCENARIOS.map(sc => `<option value="${sc.id}">${escapeHtml(sc.name)}</option>`).join('');
  const describe = () => {
    const scenario = SCENARIOS.find(sc => sc.id === scenarioSelect.value);
    document.getElementById('scenarioDesc')!.textContent =
      scenario?.description ?? 'Random drift from the current sliders.';
    seedInput.value = scenario ? String(scenario.seed) : '';
    document.getElementById('seedNote')!.textContent = '';
  };
  scenarioSelect.addEventListener('change', describe);
  describe();
}

/** Lock or unlock the controls a run would overwrite, and update the status chip. */
function setRunning(on: boolean, chipLabel: string) {
  simRunning = on;
  document.querySelectorAll<HTMLInputElement>('.controls-panel .slider').forEach(el => { el.disabled = on; });
  for (const id of ['wearToggle', 'scenarioSelect', 'seedInput', 'btnRandomize', 'btnSimulate']) {
    (document.getElementById(id) as HTMLInputElement | HTMLButtonElement).disabled = on;
  }
  document.getElementById('btnSimulate')!.textContent = on ? 'Simulating\u2026' : 'Simulate 24h';
  const simChip = document.getElementById('simStatusChip')!;
  simChip.textContent = on ? `Running \u00b7 ${chipLabel}` : chipLabel;
  simChip.className = on ? 'status-chip active' : 'status-chip';
}

function syncWearablesUI() {
  wearToggle.checked = state.useWearables;
  document.getElementById('vitalsSection')!.classList.toggle('hidden', !state.useWearables);
}

async function runSimulation() {
  const myRun = ++runId;
  const scenario = SCENARIOS.find(sc => sc.id === scenarioSelect.value);
  const seed = parseSeed(seedInput.value) ?? randomSeed();
  timelineEvents = [];
  simSnapshots = [];
  highStreak = 0;

  // Lock out LLM for the entire simulation run
  setRunning(true, scenario?.name ?? 'Random day');
  stopLLMWork();
  lastLLMMessages = null;
  prevSignature = '';

  const start = startStateFor(seed, state, lastRun);
  lastRun = { seed, start: { ...start } };
  const snapshots = simulate24h(DEFAULT_BASELINE, start, { rng: createRng(seed), scenario });

  for (const snap of snapshots) {
    if (myRun !== runId) return; // Reset or a newer run took over
    simSnapshots.push(snap);

    Object.assign(state, snap.state);
    timelineEvents.push(...snap.events);
    highStreak = snap.highStreak; // same streak the simulation used, so the level matches

    syncSlidersFromState();
    syncWearablesUI();
    update(); // LLM gated out by simRunning flag

    await sleep(scenario ? 500 : 120); // stories play slowly enough to narrate
  }
  if (myRun !== runId) return;

  // Simulation complete — unlock LLM, do one final update
  document.getElementById('seedNote')!.textContent = `Ran seed ${seed}`;
  setRunning(false, 'Complete');
  update(); // This will trigger maybeRequestLLM if signature changed
}

function resetAll() {
  runId++; // stops any playback in progress
  state = defaultState();
  highStreak = 0;
  timelineEvents = [];
  simSnapshots = [];
  lastLLMMessages = null;
  prevSignature = '';
  stopLLMWork();

  setRunning(false, 'Idle');
  syncSlidersFromState();
  syncWearablesUI();
  update();
}

function randomize() {
  state.timeOfDay = Math.random() * 24;
  state.mobility = 15 + Math.random() * 80;
  state.restlessness = 5 + Math.random() * 85;
  state.speechDrift = 5 + Math.random() * 80;
  state.socialIsolation = 10 + Math.random() * 80;
  state.staffLoad = 10 + Math.random() * 80;
  if (state.useWearables) {
    state.heartRate = 55 + Math.random() * 75;
    state.spO2 = 88 + Math.random() * 12;
  }
  highStreak = 0;
  lastLLMMessages = null;
  prevSignature = '';
  syncSlidersFromState();
  update();
}

// ── Helpers ─────────────────────────────────────────────────
function bindSlider(
  id: string, min: number, max: number, step: number,
  initial: number, setter: (v: number) => void
) {
  const slider = document.getElementById(`${id}Slider`) as HTMLInputElement;
  const display = document.getElementById(`${id}Val`) as HTMLSpanElement;
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(initial);
  display.textContent = formatSliderVal(id, initial);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    setter(v);
    highStreak = 0; // "repeated high" only means something inside a simulated day
    display.textContent = formatSliderVal(id, v);
    update();
  });
}

function formatSliderVal(id: string, v: number): string {
  if (id === 'time') {
    const h = Math.floor(v);
    const m = Math.floor((v % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  if (id === 'spo2') return `${v.toFixed(1)}%`;
  if (id === 'hr') return `${Math.round(v)} bpm`;
  return `${Math.round(v)}`;
}

function syncSlidersFromState() {
  setSl('time', state.timeOfDay);
  setSl('mobility', state.mobility);
  setSl('restlessness', state.restlessness);
  setSl('speech', state.speechDrift);
  setSl('social', state.socialIsolation);
  setSl('staffLoad', state.staffLoad);
  setSl('hr', state.heartRate);
  setSl('spo2', state.spO2);
}

function setSl(id: string, v: number) {
  const sl = document.getElementById(`${id}Slider`) as HTMLInputElement | null;
  const disp = document.getElementById(`${id}Val`) as HTMLSpanElement | null;
  if (sl) sl.value = String(v);
  if (disp) disp.textContent = formatSliderVal(id, v);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── HTML Template ───────────────────────────────────────────
function buildHTML(): string {
  return `
<header class="app-header">
  <div class="header-inner">
    <div class="logo">
      <div class="logo-mark">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" opacity="0.4"/>
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" opacity="0.5"/>
        </svg>
      </div>
      <span class="logo-text">AURA</span>
    </div>
    <div class="header-divider"></div>
    <span class="header-subtitle">Ambient Care Simulator</span>
    <div class="header-chips">
      <span id="simStatusChip" class="status-chip">Idle</span>
      <span id="llmActiveBadge" class="header-llm-badge hidden">LLM Active</span>
    </div>
  </div>
</header>

<main class="layout">
  <!-- LEFT COLUMN: Controls -->
  <aside class="controls-panel">
    <h2 class="panel-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
      Scenario Controls
    </h2>

    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      Time
    </div>
    <div class="control-group">
      <label>Time of Day <span id="timeVal" class="slider-val"></span></label>
      <input type="range" id="timeSlider" class="slider" />
      <div class="slider-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div>
    </div>

    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      Resident Signals
    </div>
    <div class="control-group">
      <label>Mobility Stability <span id="mobilityVal" class="slider-val"></span></label>
      <input type="range" id="mobilitySlider" class="slider" />
    </div>
    <div class="control-group">
      <label>Restlessness <span id="restlessnessVal" class="slider-val"></span></label>
      <input type="range" id="restlessnessSlider" class="slider" />
    </div>
    <div class="control-group">
      <label>Speech Clarity Drift <span id="speechVal" class="slider-val"></span></label>
      <input type="range" id="speechSlider" class="slider" />
    </div>
    <div class="control-group">
      <label>Social Isolation Trend <span id="socialVal" class="slider-val"></span></label>
      <input type="range" id="socialSlider" class="slider" />
    </div>

    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      Wearables
    </div>
    <div class="control-group toggle-group">
      <label class="toggle-label">
        <input type="checkbox" id="wearToggle" />
        <span class="toggle-switch"></span>
        Enable Wearable Vitals
      </label>
    </div>
    <div id="vitalsSection" class="vitals-section hidden">
      <div class="control-group">
        <label>Heart Rate <span id="hrVal" class="slider-val"></span></label>
        <input type="range" id="hrSlider" class="slider" />
      </div>
      <div class="control-group">
        <label>SpO2 <span id="spo2Val" class="slider-val"></span></label>
        <input type="range" id="spo2Slider" class="slider" />
      </div>
    </div>

    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
      Staff
    </div>
    <div class="control-group">
      <label>Staff Load <span id="staffLoadVal" class="slider-val"></span></label>
      <input type="range" id="staffLoadSlider" class="slider" />
    </div>

    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>
      Scenario
    </div>
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

    <div class="btn-row">
      <button id="btnSimulate" class="btn btn-primary">Simulate 24h</button>
      <button id="btnRandomize" class="btn btn-secondary">Randomize</button>
      <button id="btnReset" class="btn btn-ghost">Reset</button>
    </div>

    <!-- LLM Configuration -->
    <div class="llm-config-section">
      <div class="section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        LLM Messaging
      </div>
      <div class="llm-header-row">
        <label class="toggle-label">
          <input type="checkbox" id="llmToggle" />
          <span class="toggle-switch"></span>
          Adaptive Messages
        </label>
        <button id="btnRefreshLLM" class="btn btn-secondary btn-icon hidden" title="Refresh LLM message now">&#x21bb;</button>
      </div>

      <div class="llm-status-row">
        <span id="llmCallStatus" class="llm-call-status llm-call-idle">LLM: idle</span>
        <span id="llmCallCount" class="llm-call-count"></span>
      </div>

      <div id="llmConfigBody" class="llm-config-body hidden">
        <div class="control-group">
          <label>API Key</label>
          <input type="password" id="llmApiKey" class="text-input" placeholder="sk-..." autocomplete="off" />
        </div>
        <div class="control-group">
          <label>Base URL</label>
          <input type="text" id="llmBaseUrl" class="text-input" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="control-group">
          <label>Model</label>
          <input type="text" id="llmModel" class="text-input" placeholder="gpt-4o-mini" />
        </div>
        <div class="llm-config-footer">
          <button id="btnTestLLM" class="btn btn-secondary btn-sm">Test Connection</button>
          <span id="llmStatus" class="llm-status"></span>
        </div>
        <p class="llm-hint">Key stored locally. Compatible with OpenAI, Ollama, LM Studio.</p>
      </div>
    </div>
  </aside>

  <!-- RIGHT COLUMN: Outputs -->
  <section class="output-panel">
    <div class="risk-grid">
      <div id="fallRisk" class="risk-card"></div>
      <div id="cogRisk" class="risk-card"></div>
      <div id="loneRisk" class="risk-card"></div>
      <div id="overallRisk" class="risk-card overall"></div>
    </div>

    <div class="card">
      <h3 class="card-title">Intervention Output</h3>
      <div id="interventionContent"></div>
    </div>

    <div class="card">
      <h3 class="card-title">Why This Decision?</h3>
      <div id="explanationContent"></div>
    </div>

    <div class="charts-row">
      <div class="card chart-card">
        <h3 class="card-title">Baseline vs Current</h3>
        <div id="comparisonChart"></div>
      </div>
      <div class="card chart-card">
        <h3 class="card-title">24h Risk Trends</h3>
        <div id="timelineChart"></div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Event Timeline</h3>
      <div id="eventFeed" class="event-feed"></div>
    </div>
  </section>
</main>

<footer class="app-footer">
  <p>(c)2026 - Murat Baturay / AURA-Senior &mdash; Prototype for demonstration only. Not a medical device.</p>
</footer>
  `;
}
