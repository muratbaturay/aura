import type {
  LLMMessageContext,
  LLMGeneratedMessages,
  LLMConfig,
  InterventionLevel,
} from '../types';
import { urgencyBand } from '../risk';

// ── Storage ─────────────────────────────────────────────────

const STORAGE_KEY = 'aura_llm_config';

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LLMConfig;
  } catch { /* ignore */ }
  return {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    enabled: false,
  };
}

export function saveLLMConfig(config: LLMConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isLLMAvailable(config: LLMConfig): boolean {
  return config.enabled && config.apiKey.length > 0;
}

// ── Prompt Construction ─────────────────────────────────────

const LEVEL_LABELS: Record<InterventionLevel, string> = {
  1: 'Ambient Cue (environmental only)',
  2: 'Gentle Prompt (resident message)',
  3: 'Staff Soft Alert (resident + staff message)',
  4: 'Escalation (urgent staff + resident reassurance)',
};

function buildSystemPrompt(): string {
  return `You are a message-generation module inside AURA, an ambient care system for assisted-living facilities. Your job is to produce exactly three fields in JSON:

{
  "residentMessage": string | null,
  "staffMessage": string | null,
  "explanationText": string
}

RULES — RESIDENT MESSAGE:
- Never alarming or anxiety-inducing.
- No medical claims, diagnostic language, or clinical terms.
- Maximum 2 short sentences.
- Warm, gentle, supportive tone — like a kind neighbor.
- For Level 1 (Ambient Cue), set to null (no spoken message needed).
- Refer to the resident by first name when provided.

RULES — STAFF MESSAGE:
- Concise cause-and-effect reasoning in 1–2 sentences.
- Name the top contributing factor and the risk compared with the resident's usual (e.g. "fall risk 90, usual 77"). Scores are 0–100 indices, never percentages.
- Actionable: what to check or do.
- For Level 1 and Level 2, set to null (no staff alert needed).
- Professional but warm tone.

RULES — EXPLANATION TEXT:
- 2–3 sentences for the "Why this decision?" panel.
- Non-technical language a family member could understand.
- Reference the specific contributing factors and how they combine.
- Never use the word "algorithm" or "AI decided".
- Frame as observation-based reasoning.

NEVER output anything outside the JSON object. No markdown fences.`;
}

export function buildUserPrompt(ctx: LLMMessageContext): string {
  const timeStr = `${Math.floor(ctx.timeOfDay).toString().padStart(2, '0')}:${Math.floor((ctx.timeOfDay % 1) * 60).toString().padStart(2, '0')}`;
  const isNight = ctx.timeOfDay >= 22 || ctx.timeOfDay < 6;

  // Risk now with her usual, and the change band that drives the level
  const riskLine = (label: string, d: 'fall' | 'cognitive' | 'loneliness') => {
    const change = `${urgencyBand(ctx.riskScores[d])} (${Math.round(ctx.riskScores[d])}/100)`;
    return ctx.standingScores && ctx.usualScores
      ? `- ${label}: ${Math.round(ctx.standingScores[d])} (usual ${Math.round(ctx.usualScores[d])}); change from usual: ${change}`
      : `- ${label}: ${change}`;
  };

  let vitalsNote = '';
  if (ctx.useWearables && ctx.heartRate !== undefined && ctx.spO2 !== undefined) {
    vitalsNote = `Wearable vitals: HR ${Math.round(ctx.heartRate)} bpm, SpO2 ${ctx.spO2!.toFixed(0)}%.`;
  }

  return `CONTEXT:
- Resident: ${ctx.residentProfile.name}, age ${ctx.residentProfile.age}
- Mobility baseline: ${ctx.residentProfile.mobilityBaseline}/100
- Cognitive concern vs usual: ${ctx.residentProfile.cognitiveConcernLevel}
- Time: ${timeStr} (${isNight ? 'nighttime' : 'daytime'})
${riskLine('Fall risk', 'fall')}
${riskLine('Cognitive concern', 'cognitive')}
${riskLine('Loneliness', 'loneliness')}
- Overall urgency: ${Math.round(ctx.riskScores.overall)}/100 (${urgencyBand(ctx.riskScores.overall)})
- Intervention level: ${ctx.interventionLevel} — ${LEVEL_LABELS[ctx.interventionLevel]}
- Top contributing factors: ${ctx.topContributingFactors.join(', ')}
- Staff load: ${Math.round(ctx.staffLoad)}/100
${vitalsNote}

Generate the JSON response following the system rules.`;
}

// ── API Call (with AbortSignal) ─────────────────────────────

export async function generateLLMMessages(
  ctx: LLMMessageContext,
  config: LLMConfig,
  signal?: AbortSignal
): Promise<LLMGeneratedMessages> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model: config.model,
    temperature: 0.6,
    max_tokens: 300,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(ctx) },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content: string = json.choices?.[0]?.message?.content ?? '';

  return parseLLMResponse(content);
}

function parseLLMResponse(raw: string): LLMGeneratedMessages {
  const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();

  const parsed = JSON.parse(cleaned);

  return {
    residentMessage: typeof parsed.residentMessage === 'string'
      ? parsed.residentMessage.slice(0, 200)
      : null,
    staffMessage: typeof parsed.staffMessage === 'string'
      ? parsed.staffMessage.slice(0, 300)
      : null,
    explanationText: typeof parsed.explanationText === 'string'
      ? parsed.explanationText.slice(0, 500)
      : 'The system is monitoring the resident based on current observations.',
  };
}

// ── LLM Call Controller ─────────────────────────────────────
// Single centralized controller: debounce + abort + status

export type LLMStatus = 'idle' | 'generating' | 'error';

export interface LLMController {
  /** Schedule an LLM call (debounced). Aborts any in-flight request first. */
  request(
    ctx: LLMMessageContext,
    config: LLMConfig,
    onResult: (msgs: LLMGeneratedMessages) => void,
    onError: (err: Error) => void,
  ): void;
  /** Force-trigger immediately (e.g. "Refresh Message" button). */
  forceRequest(
    ctx: LLMMessageContext,
    config: LLMConfig,
    onResult: (msgs: LLMGeneratedMessages) => void,
    onError: (err: Error) => void,
  ): void;
  /** Kill everything: clear timer, abort fetch, reset to idle. */
  stopAll(): void;
  /** Current status */
  status(): LLMStatus;
  /** Number of completed API calls (for dev diagnostics) */
  callCount(): number;
}

export function createLLMController(debounceMs = 600): LLMController {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let abortCtrl: AbortController | null = null;
  let currentStatus: LLMStatus = 'idle';
  let calls = 0;

  function clearTimer() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function abortInflight() {
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
  }

  async function execute(
    ctx: LLMMessageContext,
    config: LLMConfig,
    onResult: (msgs: LLMGeneratedMessages) => void,
    onError: (err: Error) => void,
  ) {
    abortInflight();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;

    currentStatus = 'generating';
    try {
      const msgs = await generateLLMMessages(ctx, config, signal);
      // Only deliver if not aborted between await and here
      if (!signal.aborted) {
        calls++;
        currentStatus = 'idle';
        onResult(msgs);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (signal && signal.aborted)) {
        // Silently swallow aborts — caller already moved on
        return;
      }
      currentStatus = 'error';
      onError(err as Error);
    }
  }

  return {
    request(ctx, config, onResult, onError) {
      clearTimer();
      timerId = setTimeout(() => {
        timerId = null;
        execute(ctx, config, onResult, onError);
      }, debounceMs);
    },

    forceRequest(ctx, config, onResult, onError) {
      clearTimer();
      execute(ctx, config, onResult, onError);
    },

    stopAll() {
      clearTimer();
      abortInflight();
      currentStatus = 'idle';
    },

    status() {
      return currentStatus;
    },

    callCount() {
      return calls;
    },
  };
}

// ── Legacy exports (kept for compat, delegate to a default controller) ──

const _default = createLLMController();

export function debouncedGenerate(
  ctx: LLMMessageContext,
  config: LLMConfig,
  onResult: (msgs: LLMGeneratedMessages) => void,
  onError: (err: Error) => void,
  _delayMs = 800
): void {
  _default.request(ctx, config, onResult, onError);
}

export function cancelPending(): void {
  _default.stopAll();
}
