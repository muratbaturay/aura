import type { InterventionLevel } from './types';

/** Staff acknowledgement of a Level 3–4 alert. UI state only: it never changes risk or level. */
export type AckState =
  | { status: 'none' }
  | { status: 'pending'; level: 3 | 4; since: number }
  | { status: 'acknowledged'; level: 3 | 4; since: number; at: number };

export type AckEvent =
  | { type: 'level'; level: InterventionLevel; now: number }
  | { type: 'acknowledge'; now: number }
  | { type: 'reset' };

export function ackReducer(state: AckState, event: AckEvent): AckState {
  switch (event.type) {
    case 'reset':
      return { status: 'none' };
    case 'acknowledge':
      return state.status === 'pending' ? { ...state, status: 'acknowledged', at: event.now } : state;
    case 'level': {
      if (event.level < 3) return { status: 'none' };
      const level = event.level as 3 | 4;
      // A new alert: nothing raised yet, or the ladder climbed past the last alert
      if (state.status === 'none' || level > state.level) {
        return { status: 'pending', level, since: event.now };
      }
      return { ...state, level };
    }
  }
}

/** m:ss, never negative. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
