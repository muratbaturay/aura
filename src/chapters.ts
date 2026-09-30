import type { InterventionLevel } from './types';

export interface Chapter {
  hour: number;
  title: string;
}

export interface ChapterView extends Chapter {
  timeLabel: string;
  status: 'past' | 'now' | 'upcoming';
}

const LEVEL_TITLES: Record<InterventionLevel, string> = {
  1: 'Calm', 2: 'Gentle prompt', 3: 'Staff soft alert', 4: 'Escalation',
};
const MAX_CHAPTERS = 4;

/** Chapters for a day without a script: one at hour 0 and one at each level change. */
export function levelChapters(levels: InterventionLevel[]): Chapter[] {
  const changes: { hour: number; level: InterventionLevel }[] = [];
  levels.forEach((level, hour) => {
    if (hour === 0 || level !== levels[hour - 1]) changes.push({ hour, level });
  });
  let kept = changes;
  if (changes.length > MAX_CHAPTERS) {
    // Keep the opening plus the most serious turns, earliest first on ties
    const rest = changes.slice(1)
      .sort((a, b) => b.level - a.level || a.hour - b.hour)
      .slice(0, MAX_CHAPTERS - 1);
    kept = [changes[0], ...rest].sort((a, b) => a.hour - b.hour);
  }
  return kept.map(c => ({ hour: c.hour, title: LEVEL_TITLES[c.level] }));
}

/** Past / now / upcoming for each chapter at the given hour. */
export function chaptersView(chapters: Chapter[], nowHour: number): ChapterView[] {
  const now = Math.floor(nowHour);
  let current = -1;
  chapters.forEach((c, i) => { if (c.hour <= now) current = i; });
  return chapters.map((c, i) => ({
    ...c,
    timeLabel: `${String(c.hour).padStart(2, '0')}:00`,
    status: i === current ? 'now' : i < current ? 'past' : 'upcoming',
  }));
}
