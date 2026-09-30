// ── Core Types ──────────────────────────────────────────────

export interface ResidentBaseline {
  mobilityMean: number;
  mobilityVar: number;
  restlessnessMean: number;
  restlessnessVar: number;
  speechMean: number;
  speechVar: number;
  socialMean: number;
  socialVar: number;
  sleepStart: number; // hour 0-24
  sleepEnd: number;   // hour 0-24
}

export interface CurrentState {
  timeOfDay: number;       // 0–24
  mobility: number;        // 0–100 (higher = more stable)
  restlessness: number;    // 0–100
  speechDrift: number;     // 0–100
  socialIsolation: number; // 0–100
  useWearables: boolean;
  heartRate: number;       // 40–140
  spO2: number;            // 85–100
  staffLoad: number;       // 0–100
}

export interface Deviations {
  mobility: number;
  restlessness: number;
  speech: number;
  social: number;
}

export interface RiskScores {
  fall: number;        // 0–100
  cognitive: number;   // 0–100
  loneliness: number;  // 0–100
  overall: number;     // 0–100
}

export type UrgencyBand = 'Low' | 'Medium' | 'High';

export type VitalsFlag = 'none' | 'amber' | 'red';

export type InterventionLevel = 1 | 2 | 3 | 4;

export interface InterventionOutput {
  level: InterventionLevel;
  levelLabel: string;
  trigger: string;          // the ladder rule that set the level
  residentMessage: string | null;
  staffMessage: string | null;
  environmentalCue: string;
}

export type RiskDomain = 'fall' | 'cognitive' | 'loneliness';

export type RiskSignal =
  | 'mobility' | 'restlessness' | 'speech' | 'social'
  | 'night' | 'activity' | 'heartRate' | 'spO2';

/** One additive part of a domain score, before clamping. */
export interface RiskTerm {
  signal: RiskSignal;
  points: number;
}

export interface ExplanationFactor {
  factor: string;
  points: number;           // points contributed to the Overall score
}

export interface ExplanationOutput {
  factors: ExplanationFactor[];     // every non-zero contributor; points sum to overall
  topFactors: ExplanationFactor[];  // the first three of factors
  narrative: string;
}

export interface TimelineEvent {
  time: number;           // hour
  label: string;
  urgency: UrgencyBand;
  detail: string;
}

export interface SimulationSnapshot {
  hour: number;
  state: CurrentState;
  risks: RiskScores;
  intervention: InterventionOutput;
  events: TimelineEvent[];
}

// ── LLM Messaging ───────────────────────────────────────────

export interface ResidentProfile {
  age: number;
  name: string;
  mobilityBaseline: number;        // 0–100
  cognitiveConcernLevel: UrgencyBand;
}

export interface LLMMessageContext {
  residentProfile: ResidentProfile;
  riskScores: RiskScores;
  timeOfDay: number;
  interventionLevel: InterventionLevel;
  topContributingFactors: string[];
  staffLoad: number;
  useWearables: boolean;
  heartRate?: number;
  spO2?: number;
}

export interface LLMGeneratedMessages {
  residentMessage: string | null;
  staffMessage: string | null;
  explanationText: string;
}

export type MessageSource = 'template' | 'llm';

export interface EnrichedInterventionOutput extends InterventionOutput {
  source: MessageSource;
  llmExplanation?: string;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}
