import type {
  CurrentState, TimelineEvent, SimulationSnapshot,
  LLMGeneratedMessages, LLMConfig, LLMMessageContext, ResidentProfile,
  EnrichedInterventionOutput, MessageSource, InterventionOutput,
  RiskScores, ExplanationOutput, InterventionLevel,
} from './types';
import { DEFAULT_BASELINE, defaultState } from './baseline';
import { urgencyBand } from './risk';
import { assess, type Assessment } from './assessment';
import { selectIntervention } from './intervention';
import { simulate24h, startStateFor } from './simulation';
import { createRng, randomSeed, parseSeed } from './rng';
import { SCENARIOS } from './scenarios';
import { ELEANOR, RESIDENTS, residentById, type Resident } from './residents';
import { haloView, scoreBarSegments } from './view';
import { themeFor, partOfDay, resolveTheme, loadThemePreference, saveThemePreference, type ThemePreference } from './theme';
import { eventLanes, hourEvents } from './lanes';
import { createPlayback, type Playback } from './playback';
import { levelChapters, chaptersView, type Chapter } from './chapters';
import { setupRing, updateRing } from './ui/ring';
import { ackReducer, formatElapsed, type AckState, type AckEvent } from './ack';
import { buildHTML } from './ui/template';
import { createDrawer } from './ui/drawer';
import { icons } from './ui/icons';
import { renderComparisonChart, renderTimelineChart } from './chart';
import {
  loadLLMConfig, saveLLMConfig, isLLMAvailable,
  createLLMController,
} from './engine/llmMessaging';
import type { LLMStatus } from './engine/llmMessaging';
import './style.css';

// ── State ───────────────────────────────────────────────────
let resident: Resident = ELEANOR;               // whose room this is
let state: CurrentState = { ...ELEANOR.usual };
let highStreak = 0;
let hoursUp = 0;                               // consecutive night hours out of bed (during a run)
let timelineEvents: TimelineEvent[] = [];
let simSnapshots: SimulationSnapshot[] = [];
let llmConfig: LLMConfig = loadLLMConfig();
let lastLLMMessages: LLMGeneratedMessages | null = null;
let simRunning = false;
let playback: Playback | null = null;         // the current run's player (null in manual mode)
let runSnapshots: SimulationSnapshot[] = [];  // all 24 hours of the current run
let runChapters: Chapter[] = [];              // story beats (or level changes) for the current run
let ack: AckState = { status: 'none' };       // staff acknowledgement of the current alert
let ackTicker: ReturnType<typeof setInterval> | null = null;
let themePref: ThemePreference = loadThemePreference();
let runComplete = false;                      // after the first full playthrough the log shows the whole day
let lanesKey = '';                            // rebuild the lanes only when their content changes
let lastRun: { seed: number; start: CurrentState } | null = null; // for exact random-day replay
let currentRun: { name: string; seed: number } | null = null; // shown in the header chip
let selectedScenarioId = '';   // '' = random day
let speedMs = 120;             // playback interval per simulated hour
let selectStory: (id: string) => void = () => {}; // set up by setupScenarioUI

// Cached outputs for LLM panel re-renders without full update()
let lastIntervention: InterventionOutput | null = null;
let lastExplanation: ExplanationOutput | null = null;
let lastRisks: RiskScores | null = null;
let lastAssessment: Assessment | null = null;

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
  leaveRun();
  highStreak = 0;
  syncWearablesUI();
  update();
});

// Action buttons
document.getElementById('btnSimulate')!.addEventListener('click', runSimulation);
document.getElementById('btnReset')!.addEventListener('click', resetAll);
document.getElementById('btnRandomize')!.addEventListener('click', randomize);

// Scenario studio drawer + story, seed and speed controls
const seedInput = document.getElementById('seedInput') as HTMLInputElement;
const studio = createDrawer(
  document.getElementById('studio')!,
  document.getElementById('studioBackdrop')!,
  document.getElementById('btnStudio')!,
  document.getElementById('page')!,
);
document.getElementById('btnStudio')!.addEventListener('click', () => studio.open());
document.getElementById('btnStudioClose')!.addEventListener('click', () => studio.close());
setupResidentMenu();
setupScenarioUI();
setupPlaybackBar();
setupRing(document.getElementById('ringCard')!);
document.querySelector('.theme-switch')!.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-pref]');
  if (!btn) return;
  themePref = btn.dataset.themePref as ThemePreference;
  saveThemePreference(themePref);
  renderHeader();
});
document.getElementById('lanes')!.addEventListener('click', e => {
  const mark = (e.target as HTMLElement).closest<HTMLButtonElement>('.lane-mark');
  if (mark && playback) playback.seek(Number(mark.dataset.hour));
});
document.getElementById('btnAck')!.addEventListener('click', () => dispatchAck({ type: 'acknowledge', now: Date.now() }));

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
  const residentProfile: ResidentProfile = {
    name: resident.name,
    age: resident.age,
    mobilityBaseline: resident.usual.mobility,
    cognitiveConcernLevel: urgencyBand(risks.cognitive),
  };

  return {
    residentProfile,
    riskScores: risks,
    standingScores: lastAssessment?.standing,
    usualScores: lastAssessment?.usual,
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
  if (simRunning) return; // no LLM calls mid-run or while reviewing an hour
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
  // Change from her usual drives the ladder, the halo and the explanation
  const assessment = assess(state, resident, { hoursUp: playback ? hoursUp : undefined });
  const risks = assessment.alert;
  const intervention = selectIntervention(state, risks, highStreak, resident, assessment);
  lastAssessment = assessment;
  const explanation = assessment.explanation;

  // Cache for LLM panel re-renders
  lastIntervention = intervention;
  lastExplanation = explanation;
  lastRisks = risks;

  renderHeader();
  renderStatus(assessment, intervention);
  renderDay(intervention.level);
  dispatchAck({ type: 'level', level: intervention.level, now: Date.now() });

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
  renderComparisonChart(document.getElementById('comparisonChart')!, resident.baseline, state);
  renderTimelineChart(document.getElementById('timelineChart')!, simSnapshots);

  // Event feed
  renderDayLog();

  // LLM: gated trigger (no call during sim, no recursive loop)
  maybeRequestLLM(intervention, risks, explanation);
}

function renderIntervention(intervention: EnrichedInterventionOutput) {
  document.getElementById('doingSource')!.innerHTML =
    (intervention.source === 'llm'
      ? '<span class="source-badge llm-badge">AI-Generated</span>'
      : '<span class="source-badge template-badge">Template</span>') +
    (llm.status() === 'generating' ? '<span class="llm-loading-dot" aria-label="Generating"></span>' : '');

  const time = formatSliderVal('time', state.timeOfDay);
  const row = (icon: string, label: string, body: string) => `
    <div class="doing-row">
      <span class="doing-icon">${icon}</span>
      <div class="doing-body"><span class="doing-label">${label}</span>${body}</div>
    </div>`;
  const rows = [];
  if (intervention.residentMessage) {
    rows.push(row(icons.speaker, `Said to ${resident.name}`, `<p class="doing-quote">“${escapeHtml(intervention.residentMessage)}”</p>`));
  }
  if (intervention.staffMessage) {
    const label = intervention.level === 4 ? `Priority to staff · ${time}` : `Sent to staff · ${time}`;
    rows.push(row(icons.bell, label, `<p class="doing-text">${escapeHtml(intervention.staffMessage)}</p>`));
  }
  rows.push(row(icons.lamp, 'Room', `<p class="doing-text">${escapeHtml(intervention.environmentalCue)}</p>`));
  document.getElementById('interventionContent')!.innerHTML = rows.join('');
}

function dispatchAck(event: AckEvent) {
  ack = ackReducer(ack, event);
  renderAck();
}

/** The acknowledgement row, updated in place; a 1 s ticker runs only while pending. */
function renderAck() {
  const row = document.getElementById('ackRow')!;
  row.hidden = ack.status === 'none';
  row.dataset.status = ack.status;
  const btn = document.getElementById('btnAck')!;
  const text = document.getElementById('ackText')!;
  const timer = document.getElementById('ackTimer')!;
  if (ack.status === 'pending') {
    const since = ack.since;
    text.textContent = 'Waiting for staff to acknowledge';
    timer.textContent = formatElapsed(Date.now() - since);
    btn.hidden = false;
    if (!ackTicker) ackTicker = setInterval(() => {
      if (ack.status === 'pending') timer.textContent = formatElapsed(Date.now() - ack.since);
    }, 1000);
    return;
  }
  if (ackTicker) { clearInterval(ackTicker); ackTicker = null; }
  btn.hidden = true;
  if (ack.status === 'acknowledged') {
    text.textContent = 'Acknowledged after';
    timer.textContent = formatElapsed(ack.at - ack.since);
  }
}

function renderExplanation(
  explanation: ExplanationOutput,
  intervention: EnrichedInterventionOutput,
) {
  const expEl = document.getElementById('explanationContent')!;
  const segments = scoreBarSegments(explanation.factors);
  const overall = Math.round(explanation.factors.reduce((sum, f) => sum + f.points, 0));
  const barLabel = `Overall ${overall} of 100: ` +
    segments.map(s => `${s.label} ${Math.round(s.points)}`).join(', ');
  const barHTML = `
    <div class="score-bar" role="img" aria-label="${escapeHtml(barLabel)}">
      ${segments.map(s => `<div class="score-seg shade-${s.shade}" style="width:${s.widthPct}%"></div>`).join('')}
      <span class="score-mark" style="left:40%"></span>
      <span class="score-mark high" style="left:70%"></span>
    </div>
    <div class="score-scale" aria-hidden="true">
      <span class="scale-start">0</span><span style="left:40%">40</span><span class="scale-high" style="left:70%">High 70</span><span class="scale-end">100</span>
    </div>`;
  const legendHTML = `
    <ul class="score-legend">
      ${segments.map(s => `<li><span class="legend-swatch shade-${s.shade}"></span><span class="legend-name">${escapeHtml(s.label)}</span><span class="legend-val">+${Math.round(s.points)}</span></li>`).join('')}
      <li class="legend-total"><span class="legend-name">Overall</span><span class="legend-val">${overall}</span></li>
    </ul>`;

  const narrativeText = intervention.llmExplanation ?? explanation.narrative;
  const narrativeSource = intervention.llmExplanation
    ? '<span class="source-badge llm-badge narrative-badge">AI-Generated</span>'
    : '';

  expEl.innerHTML = `
    <p class="decision-trigger">${escapeHtml(intervention.trigger)}</p>
    ${barHTML}
    ${legendHTML}
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

/** Theme, clock and resident line follow the simulated time of day. */
function renderHeader() {
  const nightHour = themeFor(state.timeOfDay, DEFAULT_BASELINE) === 'night';
  const theme = resolveTheme(themePref, state.timeOfDay, DEFAULT_BASELINE);
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>('.theme-switch [data-theme-pref]').forEach(b =>
    b.setAttribute('aria-checked', String(b.dataset.themePref === themePref)));
  document.getElementById('residentSub')!.textContent = theme === 'night' ? 'Care view · night display' : 'Care view';
  // The clock and the day title describe the time, whatever the display theme
  document.getElementById('clockIcon')!.innerHTML = nightHour ? icons.moon : icons.sun;
  document.getElementById('clockTime')!.textContent = formatSliderVal('time', state.timeOfDay);
  document.getElementById('clockPart')!.textContent = partOfDay(state.timeOfDay);
  document.getElementById('dayTitle')!.textContent = nightHour ? 'Tonight' : 'Today';
}

/** Update the status card in place (re-rendering would restart the halo's breathing). */
function renderStatus(a: Assessment, intervention: InterventionOutput) {
  const card = document.getElementById('statusCard')!;
  const halo = haloView(intervention.level);
  card.dataset.level = String(intervention.level);
  card.style.setProperty('--halo-color', `var(${halo.colorVar})`);
  card.style.setProperty('--halo-period', `${halo.periodSec}s`);

  document.getElementById('haloScore')!.textContent = String(Math.round(a.alert.overall));
  document.getElementById('statusPill')!.textContent =
    `Level ${intervention.level} · ${urgencyBand(a.alert.overall)}`;
  document.getElementById('statusLabel')!.textContent = intervention.levelLabel;

  // Bars show how risky she is now, with a tick at her usual; the band is the change
  for (const id of ['fall', 'cognitive', 'loneliness'] as const) {
    const band = urgencyBand(a.alert[id]);
    const fill = document.getElementById(`${id}Fill`)!;
    fill.style.width = `${Math.min(100, a.standing[id])}%`;
    fill.dataset.band = band;
    document.getElementById(`${id}UsualTick`)!.style.left = `${Math.min(100, a.usual[id])}%`;
    document.getElementById(`${id}Usual`)!.textContent =
      `${id === 'fall' ? a.fallReference : 'usual'} ${Math.round(a.usual[id])}`;
    document.getElementById(`${id}Band`)!.textContent = band;
    document.getElementById(`${id}Value`)!.textContent = String(Math.round(a.standing[id]));
  }

  document.getElementById('ladder')!.querySelectorAll<HTMLElement>('.ladder-step').forEach(step => {
    const n = Number(step.dataset.step);
    step.classList.toggle('is-reached', n <= intervention.level);
    step.classList.toggle('is-current', n === intervention.level);
  });

  document.getElementById('vitalsRow')!.hidden = !state.useWearables;
  document.getElementById('wearablesNote')!.hidden = state.useWearables;
  document.getElementById('vitalHr')!.textContent = String(Math.round(state.heartRate));
  document.getElementById('vitalSpo2')!.textContent = String(+state.spO2.toFixed(1));
}

const SEVERITY_FILL: Record<string, string> = { Low: 'var(--c-level-1)', Medium: 'var(--c-level-2)', High: 'var(--c-level-4)' };

/**
 * Day log: one lane per kind of event across the 24 hours. The first playthrough
 * reveals hours as they play; once complete, the whole day stays visible for review.
 */
function renderDayLog() {
  const events = runComplete ? runSnapshots.flatMap(sn => sn.events) : timelineEvents;
  const hour = Math.floor(state.timeOfDay) % 24;
  const lanesEl = document.getElementById('lanes')!;

  const key = `${currentRun?.seed ?? '-'}:${runComplete ? 'all' : simSnapshots.length}`;
  if (key !== lanesKey) {
    lanesKey = key;
    const axis = Array.from({ length: 24 }, (_, h) =>
      `<span class="lane-tick mono">${h % 4 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('');
    lanesEl.innerHTML = `
      <div class="lane-row lane-axis" aria-hidden="true"><span class="lane-label"></span>${axis}</div>
      ${eventLanes(events).map(lane => `
      <div class="lane-row" data-lane="${lane.id}">
        <span class="lane-label">${lane.label}</span>
        ${lane.cells.map(c => c.severity === null ? '<span class="lane-cell"></span>' : `
        <span class="lane-cell"><button type="button" class="lane-mark" data-hour="${c.hour}"
          data-sev="${c.severity}" style="--mark:${SEVERITY_FILL[c.severity]}"
          aria-label="${String(c.hour).padStart(2, '0')}:00 · ${escapeHtml(c.events[0].label)} · ${c.severity}"></button></span>`).join('')}
      </div>`).join('')}
      <span class="lane-now" id="laneNow" aria-hidden="true"></span>`;
  }
  const now = document.getElementById('laneNow')!;
  now.hidden = !playback;
  now.style.setProperty('--now', String((hour + 0.5) / 24));

  const detail = document.getElementById('logDetail')!;
  if (!playback) {
    detail.innerHTML = '<p class="log-hint">Play a day from the Scenario studio to see its events.</p>';
    return;
  }
  const here = hourEvents(events, hour);
  const hh = `${String(hour).padStart(2, '0')}:00`;
  detail.innerHTML = here.length === 0
    ? `<p class="log-line"><span class="log-time mono">${hh}</span><span class="log-text log-quiet">Nothing noted this hour.</span></p>`
    : here.map(e => `<p class="log-line"><span class="log-dot" style="background:${SEVERITY_FILL[e.urgency]}"></span><span class="log-time mono">${hh}</span><span class="log-text"><strong>${escapeHtml(e.label)}</strong> — ${escapeHtml(e.detail)}</span></p>`).join('');
}

// ── Simulation ──────────────────────────────────────────────
// ── Residents ───────────────────────────────────────────────
function setupResidentMenu() {
  const btn = document.getElementById('btnResident')!;
  const menu = document.getElementById('residentMenu')!;
  menu.innerHTML = RESIDENTS.map(r => `
    <button type="button" role="option" class="resident-option" data-id="${r.id}" aria-selected="false">
      <span class="resident-option-name">${escapeHtml(r.name)}, ${r.age}</span>
      <span class="resident-option-summary">${escapeHtml(r.summary)}</span>
    </button>`).join('');
  const close = (refocus: boolean) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  };
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  });
  menu.addEventListener('click', e => {
    const opt = (e.target as HTMLElement).closest<HTMLButtonElement>('.resident-option');
    if (!opt) return;
    close(true);
    if (opt.dataset.id !== resident.id) selectResident(opt.dataset.id!);
  });
  menu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
  document.addEventListener('click', e => {
    if (!menu.hidden && !(e.target as HTMLElement).closest('.resident-switch')) close(false);
  });
  renderResident();
}

function renderResident() {
  document.getElementById('residentName')!.textContent = `${resident.name}, ${resident.age}`;
  document.querySelectorAll<HTMLButtonElement>('#residentMenu .resident-option').forEach(o =>
    o.setAttribute('aria-selected', String(o.dataset.id === resident.id)));
}

/** Switch rooms: any run ends and her usual levels load (the clock stays where it is). */
function selectResident(id: string) {
  leaveRun();
  dispatchAck({ type: 'reset' });
  lastRun = null;
  // A chosen story belongs to its resident: drop it when switching away
  const story = SCENARIOS.find(sc => sc.id === selectedScenarioId);
  if (story && story.residentId !== id) selectStory('');
  resident = residentById(id);
  state = { ...resident.usual, timeOfDay: state.timeOfDay };
  highStreak = 0;
  lastLLMMessages = null;
  prevSignature = '';
  stopLLMWork();
  syncSlidersFromState();
  syncWearablesUI();
  renderResident();
  update();
}

function setupScenarioUI() {
  const LEVEL_FILL: Record<number, string> = { 1: 'var(--c-level-1)', 2: 'var(--c-level-2)', 3: 'var(--c-level-3)', 4: 'var(--c-level-4)' };
  // Each story card previews its whole day at the default seed
  const cards = [{ id: '', name: 'Random day', description: 'Drifts from the current sliders. Different every run.', meta: 'any seed', arc: null as number[] | null }]
    .concat(SCENARIOS.map(sc => {
      const levels = simulate24h(residentById(sc.residentId), defaultState(), { rng: createRng(sc.seed), scenario: sc })
        .map(snap => snap.intervention.level);
      return { id: sc.id, name: sc.name, description: sc.description, meta: `${residentById(sc.residentId).name} · peaks at L${Math.max(...levels)} · seed ${sc.seed}`, arc: levels };
    }));
  const list = document.getElementById('storyList')!;
  list.innerHTML = cards.map(c => `
    <button type="button" class="story-card" data-id="${c.id}" aria-pressed="false">
      <span class="story-card-head"><span class="story-card-name">${escapeHtml(c.name)}</span><span class="story-card-meta mono">${escapeHtml(c.meta)}</span></span>
      <span class="story-card-desc">${escapeHtml(c.description)}</span>
      <span class="story-arc" aria-hidden="true">${Array.from({ length: 24 }, (_, h) =>
        `<span style="background:${c.arc ? LEVEL_FILL[c.arc[h]] : 'var(--ring-future)'}"></span>`).join('')}</span>
    </button>`).join('');

  const select = (id: string) => {
    selectedScenarioId = id;
    const scenario = SCENARIOS.find(sc => sc.id === id);
    if (scenario && scenario.residentId !== resident.id) selectResident(scenario.residentId);
    list.querySelectorAll<HTMLButtonElement>('.story-card').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    seedInput.value = scenario ? String(scenario.seed) : '';
    document.getElementById('seedNote')!.textContent = '';
    document.getElementById('btnSimulateLabel')!.textContent = scenario ? `Play ${scenario.name}` : 'Play a random day';
    setSpeed(scenario ? 500 : 120);
  };
  selectStory = select;
  list.addEventListener('click', e => {
    const card = (e.target as HTMLElement).closest<HTMLButtonElement>('.story-card');
    if (card && !card.disabled) select(card.dataset.id ?? '');
  });
  document.getElementById('speedControl')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-speed]');
    if (btn) setSpeed(Number(btn.dataset.speed));
  });
  document.getElementById('btnNewSeed')!.addEventListener('click', () => { seedInput.value = String(randomSeed()); });
  select('');
}

function setSpeed(ms: number) {
  speedMs = ms;
  playback?.setIntervalMs(ms);
  if (playback) renderPlaybackBar();
  document.querySelectorAll<HTMLButtonElement>('#speedControl [data-speed]').forEach(b =>
    b.setAttribute('aria-checked', String(Number(b.dataset.speed) === ms)));
}

/** Lock or unlock the controls a run would overwrite, and update the header's story chip. */
function setRunning(on: boolean, status: string) {
  document.querySelectorAll<HTMLInputElement>('.studio .slider').forEach(el => { el.disabled = on; });
  document.querySelectorAll<HTMLButtonElement>('.story-card').forEach(el => { el.disabled = on; });
  for (const id of ['wearToggle', 'seedInput', 'btnNewSeed', 'btnRandomize', 'btnSimulate', 'btnRefreshLLM']) {
    (document.getElementById(id) as HTMLInputElement | HTMLButtonElement).disabled = on;
  }
  const chip = document.getElementById('storyChip')!;
  chip.hidden = !currentRun;
  if (currentRun) {
    document.getElementById('storyName')!.textContent = currentRun.name;
    document.getElementById('storySeed')!.textContent = `seed ${currentRun.seed}`;
    document.getElementById('storyStatus')!.textContent = status;
    chip.classList.toggle('is-running', on);
  }
}

function syncWearablesUI() {
  wearToggle.checked = state.useWearables;
  document.getElementById('vitalsSection')!.classList.toggle('hidden', !state.useWearables);
}

function runSimulation() {
  const scenario = SCENARIOS.find(sc => sc.id === selectedScenarioId);
  const seed = parseSeed(seedInput.value) ?? randomSeed();
  studio.close();
  playback?.stop();
  currentRun = { name: scenario?.name ?? 'Random day', seed };

  dispatchAck({ type: 'reset' });

  // No LLM calls from here until the run reaches its last hour
  simRunning = true;
  stopLLMWork();
  lastLLMMessages = null;
  prevSignature = '';

  const start = startStateFor(seed, state, lastRun);
  lastRun = { seed, start: { ...start } };
  if (scenario && scenario.residentId !== resident.id) selectResident(scenario.residentId);
  runSnapshots = simulate24h(resident, start, { rng: createRng(seed), scenario });
  runComplete = false;
  runChapters = scenario?.chapters ?? levelChapters(runSnapshots.map(sn => sn.intervention.level));
  buildChapters();

  setRunning(true, 'Playing');
  playback = createPlayback({
    length: runSnapshots.length,
    intervalMs: speedMs,
    onFrame: showHour,
    onEnd: () => {
      runComplete = true;
      simRunning = false; // the run is over: adaptive messages may update once
      document.getElementById('seedNote')!.textContent = `Ran seed ${seed}`;
      setRunning(false, 'Complete');
      update();
      renderPlaybackBar();
    },
  });
  playback.play();
}

/** Show hour i of the current run: the state, the events so far and the streak it used. */
function showHour(i: number) {
  // Messages generated for another hour must not appear here
  stopLLMWork();
  lastLLMMessages = null;
  prevSignature = '';
  const snap = runSnapshots[i];
  simSnapshots = runSnapshots.slice(0, i + 1);
  timelineEvents = simSnapshots.flatMap(sn => sn.events);
  Object.assign(state, snap.state);
  highStreak = snap.highStreak; // same streak the simulation used, so the level matches
  hoursUp = snap.hoursUp;
  simRunning = true;            // mid-run and reviewing an hour both keep LLM calls off
  syncSlidersFromState();
  syncWearablesUI();
  update();
  renderPlaybackBar();
}

/** Manual input or Reset: drop the run and its history, back to manual mode. */
function leaveRun() {
  if (!playback) return;
  playback.stop();
  playback = null;
  runSnapshots = [];
  simSnapshots = [];
  timelineEvents = [];
  currentRun = null;
  simRunning = false;
  runChapters = [];
  runComplete = false;
  buildChapters();
  setRunning(false, '');
  renderPlaybackBar();
}

/** The ring shows the run so far, or just the current hour in manual mode. */
function renderDay(level: InterventionLevel) {
  const levels: (InterventionLevel | null)[] = Array(24).fill(null);
  let since: number | null = null;
  if (playback && simSnapshots.length > 0) {
    for (const sn of simSnapshots) levels[sn.hour] = sn.intervention.level;
    let h = simSnapshots.length - 1;
    while (h > 0 && simSnapshots[h - 1].intervention.level === level) h--;
    since = simSnapshots[h].hour;
  } else {
    levels[Math.floor(state.timeOfDay) % 24] = level;
  }
  updateRing(levels, state.timeOfDay % 24, level, since);
  updateChapters();
}

function buildChapters() {
  const el = document.getElementById('chapters')!;
  el.hidden = runChapters.length === 0;
  el.innerHTML = runChapters.map(c => `
    <button type="button" class="chapter" data-hour="${c.hour}">
      <span class="chapter-time mono">${String(c.hour).padStart(2, '0')}:00</span>
      <span class="chapter-title">${escapeHtml(c.title)}</span>
    </button>`).join('');
}

function updateChapters() {
  if (runChapters.length === 0) return;
  const views = chaptersView(runChapters, state.timeOfDay);
  document.querySelectorAll<HTMLButtonElement>('#chapters .chapter').forEach((btn, i) => {
    const v = views[i];
    btn.dataset.status = v.status;
    btn.querySelector('.chapter-time')!.textContent = v.status === 'now' ? `${v.timeLabel} · now` : v.timeLabel;
    if (v.status === 'now') btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
  });
}

function setupPlaybackBar() {
  document.getElementById('chapters')!.addEventListener('click', e => {
    const chapter = (e.target as HTMLElement).closest<HTMLButtonElement>('.chapter');
    if (chapter && playback) playback.seek(Number(chapter.dataset.hour));
  });
  const bar = document.getElementById('playbackBar')!;
  bar.innerHTML = `
    <button type="button" id="pbPrev" class="pb-btn" aria-label="Previous hour">${icons.prev}</button>
    <button type="button" id="pbPlay" class="pb-btn pb-main" aria-label="Pause"></button>
    <button type="button" id="pbNext" class="pb-btn" aria-label="Next hour">${icons.next}</button>
    <div class="pb-track">
      <input type="range" id="pbScrub" class="slider" min="0" max="23" step="1" value="0" aria-label="Hour of the simulated day" />
      <div class="pb-labels mono"><span>00:00</span><span id="pbSpeed"></span><span>24:00</span></div>
    </div>`;
  document.getElementById('pbPrev')!.addEventListener('click', () => playback?.step(-1));
  document.getElementById('pbNext')!.addEventListener('click', () => playback?.step(1));
  document.getElementById('pbPlay')!.addEventListener('click', () => {
    if (!playback) return;
    if (playback.state().status === 'playing') playback.pause(); else playback.play();
    renderPlaybackBar();
  });
  document.getElementById('pbScrub')!.addEventListener('input', e => {
    playback?.seek(Number((e.target as HTMLInputElement).value));
  });
}

function renderPlaybackBar() {
  const bar = document.getElementById('playbackBar')!;
  bar.hidden = !playback;
  if (!playback) return;
  const { index, status } = playback.state();
  const playing = status === 'playing';
  const playBtn = document.getElementById('pbPlay')!;
  playBtn.innerHTML = playing ? icons.pause : icons.play;
  playBtn.setAttribute('aria-label', playing ? 'Pause' : status === 'ended' ? 'Replay the day' : 'Play');
  (document.getElementById('pbScrub') as HTMLInputElement).value = String(Math.max(0, index));
  document.getElementById('pbSpeed')!.textContent = `${speedMs / 1000} s per hour`;
  // Controls lock only while the day is playing; paused or finished, the user can take over
  setRunning(playing, playing ? 'Playing' : status === 'ended' ? 'Complete' : 'Paused');
}

function resetAll() {
  leaveRun();
  dispatchAck({ type: 'reset' });
  state = { ...resident.usual };
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
  leaveRun();
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
    leaveRun(); // manual input ends any run under review
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

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
