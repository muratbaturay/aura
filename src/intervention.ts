import type { CurrentState, RiskScores, InterventionOutput, InterventionLevel, VitalsFlag } from './types';
import { urgencyBand, vitalsFlag } from './risk';
import { isNightHour, DEFAULT_BASELINE } from './baseline';

type Domain = 'fall' | 'cognitive' | 'loneliness';

const DOMAIN_LABELS: Record<Domain, string> = {
  fall: 'Fall risk',
  cognitive: 'Cognitive concern',
  loneliness: 'Loneliness risk',
};

const DOMAINS: Domain[] = ['fall', 'cognitive', 'loneliness'];

export function selectIntervention(
  state: CurrentState,
  risks: RiskScores,
  recentHighCount: number
): InterventionOutput {
  const night = isNightHour(state.timeOfDay, DEFAULT_BASELINE);
  const vitals = vitalsFlag(state);
  const highDomains = DOMAINS.filter(d => urgencyBand(risks[d]) === 'High');
  const overallBand = urgencyBand(risks.overall);

  // Staff load deliberately plays no part here: the resident's risk alone sets the level.
  let level: InterventionLevel = 1;
  if (
    vitals === 'red' ||
    highDomains.length >= 2 ||
    (highDomains.length >= 1 && vitals === 'amber') ||
    recentHighCount >= 3
  ) {
    level = 4;
  } else if (overallBand === 'High' || vitals === 'amber') {
    level = 3;
  } else if (overallBand === 'Medium') {
    level = 2;
  }

  return buildIntervention(level, state, risks, night, vitals, highDomains);
}

function buildIntervention(
  level: InterventionLevel,
  state: CurrentState,
  risks: RiskScores,
  night: boolean,
  vitals: VitalsFlag,
  highDomains: Domain[]
): InterventionOutput {
  const hour = Math.floor(state.timeOfDay);
  const timeLabel = `${hour.toString().padStart(2, '0')}:${Math.floor((state.timeOfDay % 1) * 60).toString().padStart(2, '0')}`;
  const vitalsText = `SpO2 ${+state.spO2.toFixed(1)}%, HR ${Math.round(state.heartRate)} bpm`;
  const domainText = (ds: Domain[]) => ds.map(d => `${DOMAIN_LABELS[d]} High (${Math.round(risks[d])}%)`).join(', ');
  const staffNote = state.staffLoad > 65
    ? ` Staff load high (${Math.round(state.staffLoad)}%): prioritize accordingly.`
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
      const driver = DOMAINS.reduce((a, b) => (risks[b] > risks[a] ? b : a));
      const resMsg = {
        loneliness: `Good ${night ? 'evening' : 'afternoon'}! Your friend Martha mentioned she'd love to chat — would you like to give her a call?`,
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
        whyStaff = `Vitals borderline (${vitalsText}).`;
      } else if (highDomains.length > 0) {
        whyStaff = `${domainText(highDomains)} — ${night ? 'nighttime' : 'daytime'}.`;
      } else {
        const elevated = DOMAINS.filter(d => urgencyBand(risks[d]) !== 'Low')
          .map(d => `${DOMAIN_LABELS[d].toLowerCase()} ${Math.round(risks[d])}%`).join(', ');
        whyStaff = `Several concerns elevated together (${elevated}; overall ${Math.round(risks.overall)}%).`;
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
        whyEscalate = `Vitals red flag (${vitalsText}). Immediate check recommended.`;
      } else if (highDomains.length >= 2) {
        whyEscalate = `Multiple high concerns: ${domainText(highDomains)}. Prompt attention needed.`;
      } else if (highDomains.length >= 1 && vitals === 'amber') {
        whyEscalate = `${domainText(highDomains)} with borderline vitals (${vitalsText}). Prompt attention needed.`;
      } else {
        whyEscalate = `Repeated high-risk pattern (overall urgency High in 3+ recent hours). Prompt attention needed.`;
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
