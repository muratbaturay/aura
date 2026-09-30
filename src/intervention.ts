import type { CurrentState, RiskScores, InterventionOutput, InterventionLevel, VitalsFlag, RiskDomain } from './types';
import { urgencyBand, vitalsFlag, RISK_DOMAINS } from './risk';
import { isNightHour, DEFAULT_BASELINE } from './baseline';
import type { Resident } from './residents';
import type { Assessment } from './assessment';

const DOMAIN_LABELS: Record<RiskDomain, string> = {
  fall: 'Fall risk',
  cognitive: 'Cognitive concern',
  loneliness: 'Loneliness risk',
};

function vitalsText(state: CurrentState): string {
  return `SpO2 ${+state.spO2.toFixed(1)}%, HR ${Math.round(state.heartRate)} bpm`;
}

export function selectIntervention(
  state: CurrentState,
  risks: RiskScores,
  highStreak: number,       // consecutive High-overall hours before now
  resident?: Resident,      // personalises the gentle prompt (who to call)
  scores?: Pick<Assessment, 'standing' | 'usual' | 'fallReference'> // lets staff messages quote risk with its usual
): InterventionOutput {
  const night = isNightHour(state.timeOfDay, DEFAULT_BASELINE);
  const vitals = vitalsFlag(state);
  const highDomains = RISK_DOMAINS.filter(d => urgencyBand(risks[d]) === 'High');
  const overallBand = urgencyBand(risks.overall);
  const lower = (d: RiskDomain) => DOMAIN_LABELS[d].toLowerCase();

  // Staff load deliberately plays no part here: the resident's risk alone sets the level.
  let level: InterventionLevel;
  let trigger: string;
  if (vitals === 'red') {
    level = 4;
    trigger = `Level 4: vitals red flag (${vitalsText(state)}).`;
  } else if (highDomains.length >= 2) {
    level = 4;
    trigger = `Level 4: two or more areas are High (${highDomains.map(lower).join(', ')}).`;
  } else if (highDomains.length >= 1 && vitals === 'amber') {
    level = 4;
    trigger = `Level 4: ${lower(highDomains[0])} is High and vitals are borderline (${vitalsText(state)}).`;
  } else if (overallBand === 'High' && highStreak >= 2) {
    level = 4;
    trigger = 'Level 4: overall urgency has been High for 3+ hours in a row.';
  } else if (overallBand === 'High') {
    level = 3;
    trigger = 'Level 3: overall urgency is High (70+).';
  } else if (vitals === 'amber') {
    level = 3;
    trigger = `Level 3: vitals are borderline (${vitalsText(state)}).`;
  } else if (overallBand === 'Medium') {
    level = 2;
    trigger = 'Level 2: overall urgency is Medium (40–69).';
  } else {
    level = 1;
    trigger = 'Level 1: overall urgency is Low (under 40).';
  }

  const contact = resident?.contact ?? 'friend Martha';
  return { ...buildIntervention(level, state, risks, night, vitals, highDomains, contact, scores), trigger };
}

function buildIntervention(
  level: InterventionLevel,
  state: CurrentState,
  risks: RiskScores,
  night: boolean,
  vitals: VitalsFlag,
  highDomains: RiskDomain[],
  contact: string,
  scores?: Pick<Assessment, 'standing' | 'usual' | 'fallReference'>
): Omit<InterventionOutput, 'trigger'> {
  const hour = Math.floor(state.timeOfDay);
  const timeLabel = `${hour.toString().padStart(2, '0')}:${Math.floor((state.timeOfDay % 1) * 60).toString().padStart(2, '0')}`;
  // With the assessment, quote risk against her usual; otherwise the scores given
  const figure = (d: RiskDomain) => scores
    ? `${Math.round(scores.standing[d])} (${d === 'fall' ? scores.fallReference : 'usual'} ${Math.round(scores.usual[d])})`
    : `${Math.round(risks[d])}`;
  const domainText = (ds: RiskDomain[]) => ds.map(d => `${DOMAIN_LABELS[d]} ${figure(d)}`).join(', ');
  const staffNote = state.staffLoad > 65
    ? ` Staff load high (${Math.round(state.staffLoad)}/100): prioritize accordingly.`
    : '';

  switch (level) {
    case 1:
      return {
        level: 1,
        levelLabel: 'Ambient Cue',
        residentMessage: null,
        staffMessage: null,
        environmentalCue: night
          ? 'Soft warm floor-path lighting activated along bedroom → bathroom route. Gentle calming soundscape maintained.'
          : 'Room lighting adjusted to comfortable daytime level. Background music at low volume.',
      };

    case 2: {
      const driver = RISK_DOMAINS.reduce((a, b) => (risks[b] > risks[a] ? b : a));
      const resMsg = {
        loneliness: `Good ${night ? 'evening' : 'afternoon'}! Your ${contact} mentioned they'd love to chat — would you like to give them a call?`,
        fall: `Just a gentle reminder: take your time if you're getting up. The path light is on for you.`,
        cognitive: `Just so you know, it's ${partOfDay(hour)} and everything is just as it should be. Your things are right where you left them.`,
      }[driver];
      return {
        level: 2,
        levelLabel: 'Gentle Prompt',
        residentMessage: resMsg,
        staffMessage: null,
        environmentalCue: night
          ? 'Path lighting brightened slightly. Ambient tone gently raised.'
          : 'Room ambiance shifted to warmer tones to encourage settling.',
      };
    }

    case 3: {
      let whyStaff: string;
      if (vitals === 'amber') {
        whyStaff = `Vitals borderline (${vitalsText(state)}).`;
      } else if (highDomains.length > 0) {
        whyStaff = `${domainText(highDomains)} — ${night ? 'nighttime' : 'daytime'}.`;
      } else {
        const elevated = RISK_DOMAINS.filter(d => urgencyBand(risks[d]) !== 'Low')
          .map(d => `${DOMAIN_LABELS[d].toLowerCase()} ${figure(d)}`).join(', ');
        whyStaff = `Several concerns elevated together (${elevated}; urgency ${Math.round(risks.overall)}/100).`;
      }
      return {
        level: 3,
        levelLabel: 'Staff Soft Alert',
        residentMessage: 'You\'re doing great. Someone will pop by shortly just to say hello.',
        staffMessage: `Soft alert at ${timeLabel}: ${whyStaff} Supportive check-in recommended.${staffNote}`,
        environmentalCue: 'Room lighting set to calm, reassuring level. Gentle chime played in staff station.',
      };
    }

    case 4: {
      let whyEscalate: string;
      if (vitals === 'red') {
        whyEscalate = `Vitals red flag (${vitalsText(state)}). Immediate check recommended.`;
      } else if (highDomains.length >= 2) {
        whyEscalate = `Multiple high concerns: ${domainText(highDomains)}. Prompt attention needed.`;
      } else if (highDomains.length >= 1 && vitals === 'amber') {
        whyEscalate = `${domainText(highDomains)} with borderline vitals (${vitalsText(state)}). Prompt attention needed.`;
      } else {
        whyEscalate = `Overall urgency High for 3+ hours in a row (urgency ${Math.round(risks.overall)}/100). Prompt attention needed.`;
      }
      return {
        level: 4,
        levelLabel: 'Escalate',
        residentMessage: 'Help is on the way. You\'re safe — just stay comfortable where you are.',
        staffMessage: `PRIORITY at ${timeLabel}: ${whyEscalate}${staffNote}`,
        environmentalCue: 'Room lights fully on. Staff alert tone at station. Hallway indicator active.',
      };
    }
  }
}

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'nighttime';
}
