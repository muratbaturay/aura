import { icons } from './icons';

const slider = (id: string, label: string) => `
      <div class="control-group">
        <label for="${id}Slider">${label} <span id="${id}Val" class="slider-val"></span></label>
        <input type="range" id="${id}Slider" class="slider" />
      </div>`;

const domain = (id: string, name: string) => `
          <div class="domain-row">
            <div class="domain-head"><span class="domain-name">${name}</span><span id="${id}Usual" class="domain-usual"></span><span id="${id}Band" class="domain-band"></span><span id="${id}Value" class="domain-value"></span></div>
            <div class="domain-track"><div id="${id}Fill" class="domain-fill"></div><span class="band-tick" style="left:40%"></span><span class="band-tick" style="left:70%"></span><span id="${id}UsualTick" class="usual-tick" aria-hidden="true"></span></div>
          </div>`;

const ladderStep = (level: number, label: string) =>
  `<li class="ladder-step" data-step="${level}"><span class="ladder-bar"></span><span class="ladder-label">${label}</span></li>`;

export function buildHTML(): string {
  return `
<div id="page">
<header class="app-header">
  <div class="header-inner">
    <div class="brand">${icons.brand}<span class="wordmark">aura</span></div>
    <div class="header-divider"></div>
    <div class="resident-switch">
      <button type="button" id="btnResident" class="resident-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="residentMenu">
        <span class="resident-text">
          <span id="residentName" class="resident-name">Eleanor, 82</span>
          <span id="residentSub" class="resident-sub">Care view</span>
        </span>
        ${icons.chevron}
      </button>
      <div id="residentMenu" class="resident-menu" role="listbox" aria-label="Residents" hidden></div>
    </div>
    <div class="header-spacer"></div>
    <span id="storyChip" class="story-chip" hidden>
      <span id="storyDot" class="story-dot"></span>
      <span id="storyName"></span>
      <span id="storySeed" class="mono"></span>
      <span id="storyStatus" class="story-status"></span>
    </span>
    <span id="llmActiveBadge" class="header-llm-badge hidden">LLM Active</span>
    <div class="theme-switch" role="radiogroup" aria-label="Theme">
      <button type="button" role="radio" id="themeLight" data-theme-pref="light" aria-checked="false" aria-label="Light" title="Light">${icons.sunSmall}</button>
      <button type="button" role="radio" id="themeDark" data-theme-pref="dark" aria-checked="false" aria-label="Dark" title="Dark">${icons.moonSmall}</button>
      <button type="button" role="radio" id="themeAuto" data-theme-pref="auto" aria-checked="false" aria-label="Follow the clock" title="Follow the clock">${icons.clock}</button>
    </div>
    <div class="clock">
      <span id="clockIcon" class="clock-icon"></span>
      <span id="clockTime" class="clock-time mono"></span>
      <span id="clockPart" class="clock-part"></span>
    </div>
    <button id="btnHow" class="btn btn-ghost btn-pill" aria-haspopup="dialog" aria-controls="howPanel" aria-expanded="false">${icons.info}<span>How it works</span></button>
    <button id="btnStudio" class="btn btn-primary btn-pill" aria-haspopup="dialog" aria-controls="studio" aria-expanded="false">${icons.sliders}<span>Scenario studio</span></button>
  </div>
</header>

<main class="care-grid">
  <div class="care-col" id="colStatus">
    <section id="statusCard" class="card status-card" aria-label="Current state">
      <div class="halo">
        <div class="halo-ring halo-ring-outer" aria-hidden="true"></div>
        <div class="halo-ring halo-ring-mid" aria-hidden="true"></div>
        <div class="halo-ring halo-ring-inner" aria-hidden="true"></div>
        <div class="halo-core">
          <span id="haloScore" class="halo-score"></span>
          <span class="halo-caption">Overall urgency</span>
        </div>
      </div>
      <div class="status-level">
        <span id="statusPill" class="status-pill"></span>
        <span id="statusLabel" class="status-label"></span>
      </div>
      <ol id="ladder" class="ladder" aria-label="Intervention ladder">
        ${ladderStep(1, 'Ambient')}${ladderStep(2, 'Prompt')}${ladderStep(3, 'Soft alert')}${ladderStep(4, 'Escalate')}
      </ol>
      <div class="status-divider"></div>
      <div class="domain-list">${domain('fall', 'Fall risk')}${domain('cognitive', 'Cognitive concern')}${domain('loneliness', 'Loneliness')}
      </div>
      <div id="vitalsRow" class="vitals-row" hidden>
        <span class="vital">${icons.heart}<span id="vitalHr" class="mono vital-value"></span><span class="vital-unit">bpm</span></span>
        <span class="vital"><span class="vital-name">SpO2</span><span id="vitalSpo2" class="mono vital-value"></span><span class="vital-unit">%</span></span>
      </div>
      <p id="wearablesNote" class="status-note">Wearables off · signals from room sensors only</p>
    </section>
  </div>

  <div class="care-col" id="colDay">
    <section class="card day-card" aria-labelledby="dayTitle">
      <div class="day-head">
        <h2 id="dayTitle" class="day-title">Today</h2>
        <ul class="ring-legend" aria-label="Legend">
          <li><span class="legend-chip" style="background:var(--c-level-1)"></span>Calm</li>
          <li><span class="legend-chip" style="background:var(--c-level-2)"></span>Prompt</li>
          <li><span class="legend-chip" style="background:var(--c-level-3)"></span>Soft alert</li>
          <li><span class="legend-chip" style="background:var(--c-level-4)"></span>Escalate</li>
        </ul>
      </div>
      <div id="ringCard" class="ring-wrap"></div>
      <div id="playbackBar" class="playback-bar" hidden></div>
      <div id="chapters" class="chapters" hidden></div>
    </section>
  </div>

  <div class="care-col" id="colWhy">
    <section class="card">
      <h3 class="card-title">Why this decision</h3>
      <div id="explanationContent"></div>
    </section>
    <section class="card doing-card" aria-labelledby="doingTitle">
      <div class="doing-head">
        <h3 id="doingTitle" class="card-title">What AURA is doing</h3>
        <span id="doingSource"></span>
      </div>
      <div id="interventionContent" class="doing-list"></div>
      <div id="ackRow" class="ack-row" hidden>
        <span id="ackDot" class="ack-dot" aria-hidden="true"></span>
        <span id="ackText" class="ack-text" role="status"></span>
        <span id="ackTimer" class="ack-timer mono"></span>
        <button type="button" id="btnAck" class="btn btn-primary btn-sm">Acknowledge</button>
      </div>
    </section>
  </div>

  <section class="card day-log" aria-labelledby="dayLogTitle">
    <h3 id="dayLogTitle" class="card-title">Day log</h3>
    <div id="lanes" class="lanes"></div>
    <div id="logDetail" class="log-detail" aria-live="polite"></div>
  </section>
</main>

<footer class="app-footer">
  <p>(c)2026 - Murat Baturay / AURA-Senior &mdash; Prototype for demonstration only. Not a medical device.</p>
</footer>
</div>

<div id="howBackdrop" class="studio-backdrop" hidden></div>
<aside id="howPanel" class="studio how-panel" role="dialog" aria-modal="true" aria-labelledby="howTitle" hidden>
  <header class="studio-head">
    <div>
      <h2 id="howTitle" class="studio-title">How AURA works</h2>
      <p class="studio-intro">The model, its numbers, and its limits.</p>
    </div>
    <button id="btnHowClose" class="icon-btn" aria-label="Close how it works">${icons.close}</button>
  </header>
  <div id="howContent" class="how-content"></div>
</aside>

<div id="studioBackdrop" class="studio-backdrop" hidden></div>
<aside id="studio" class="studio" role="dialog" aria-modal="true" aria-labelledby="studioTitle" hidden>
  <header class="studio-head">
    <div>
      <h2 id="studioTitle" class="studio-title">Scenario studio</h2>
      <p class="studio-intro">Pick a story. With the same seed it plays exactly the same way every time.</p>
    </div>
    <button id="btnStudioClose" class="icon-btn" aria-label="Close scenario studio">${icons.close}</button>
  </header>

  <div id="storyList" class="story-list" aria-label="Stories"></div>

  <div class="control-group">
    <label for="seedInput">Seed</label>
    <div class="seed-row">
      <input type="text" inputmode="numeric" id="seedInput" class="text-input mono" placeholder="new each run" autocomplete="off" />
      <button id="btnNewSeed" class="btn btn-secondary">${icons.shuffle}<span>New seed</span></button>
    </div>
    <p id="seedNote" class="scenario-desc"></p>
  </div>

  <div class="control-group">
    <span class="control-label" id="speedLabel">Playback</span>
    <div id="speedControl" class="segmented" role="radiogroup" aria-labelledby="speedLabel">
      <button type="button" role="radio" data-speed="120" aria-checked="false"><span>Fast</span><span class="mono seg-hint">0.12 s/h</span></button>
      <button type="button" role="radio" data-speed="500" aria-checked="false"><span>Narrate</span><span class="mono seg-hint">0.5 s/h</span></button>
      <button type="button" role="radio" data-speed="1000" aria-checked="false"><span>Slow</span><span class="mono seg-hint">1 s/h</span></button>
    </div>
  </div>

  <div class="btn-row">
    <button id="btnSimulate" class="btn btn-primary btn-play">${icons.play}<span id="btnSimulateLabel">Play</span></button>
    <button id="btnRandomize" class="btn btn-secondary">Randomize</button>
    <button id="btnReset" class="btn btn-ghost">Reset to usual</button>
  </div>

  <details class="studio-section" open>
    <summary>Manual signals</summary>
    <div class="studio-section-body">
      <div class="control-group">
        <label for="timeSlider">Time of day <span id="timeVal" class="slider-val"></span></label>
        <input type="range" id="timeSlider" class="slider" />
        <div class="slider-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div>
      </div>
      ${slider('mobility', 'Mobility stability')}
      ${slider('restlessness', 'Restlessness')}
      ${slider('speech', 'Speech clarity drift')}
      ${slider('social', 'Social isolation trend')}
      <div class="control-group toggle-group">
        <label class="toggle-label">
          <input type="checkbox" id="wearToggle" />
          <span class="toggle-switch"></span>
          Wearable vitals
        </label>
      </div>
      <div id="vitalsSection" class="vitals-section hidden">
        ${slider('hr', 'Heart rate')}
        ${slider('spo2', 'SpO2')}
      </div>
      ${slider('staffLoad', 'Staff load')}
    </div>
  </details>

  <details class="studio-section">
    <summary>Signals vs baseline · risk trends</summary>
    <div class="studio-section-body">
      <h3 class="card-title">Baseline vs current</h3>
      <div id="comparisonChart"></div>
      <h3 class="card-title">24h risk trends</h3>
      <div id="timelineChart"></div>
    </div>
  </details>

  <details class="studio-section llm-config-section">
    <summary>Adaptive messages (LLM)</summary>
    <div class="studio-section-body">
      <div class="llm-header-row">
        <label class="toggle-label">
          <input type="checkbox" id="llmToggle" />
          <span class="toggle-switch"></span>
          Adaptive messages
        </label>
        <button id="btnRefreshLLM" class="btn btn-secondary btn-icon hidden" aria-label="Refresh LLM message now">&#x21bb;</button>
      </div>
      <div class="llm-status-row">
        <span id="llmCallStatus" class="llm-call-status llm-call-idle">LLM: idle</span>
        <span id="llmCallCount" class="llm-call-count"></span>
      </div>
      <div id="llmConfigBody" class="llm-config-body hidden">
        <div class="control-group">
          <label for="llmApiKey">API key</label>
          <input type="password" id="llmApiKey" class="text-input" placeholder="sk-..." autocomplete="off" />
        </div>
        <div class="control-group">
          <label for="llmBaseUrl">Base URL</label>
          <input type="text" id="llmBaseUrl" class="text-input" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="control-group">
          <label for="llmModel">Model</label>
          <input type="text" id="llmModel" class="text-input" placeholder="gpt-4o-mini" />
        </div>
        <div class="llm-config-footer">
          <button id="btnTestLLM" class="btn btn-secondary btn-sm">Test connection</button>
          <span id="llmStatus" class="llm-status"></span>
        </div>
        <p class="llm-hint">Key stored locally. Compatible with OpenAI, Ollama, LM Studio.</p>
      </div>
    </div>
  </details>
</aside>
`;
}
