import { describe, it, expect } from 'vitest';
import { ackReducer, formatElapsed, type AckState } from './ack';

const none: AckState = { status: 'none' };
const lvl = (level: 1 | 2 | 3 | 4, now: number) => ({ type: 'level' as const, level, now });

describe('ackReducer', () => {
  it('raises a pending alert when the level reaches 3', () => {
    expect(ackReducer(none, lvl(2, 0))).toEqual(none);
    expect(ackReducer(none, lvl(3, 1000))).toEqual({ status: 'pending', level: 3, since: 1000 });
  });
  it('records acknowledgement time', () => {
    const s = ackReducer(ackReducer(none, lvl(3, 1000)), { type: 'acknowledge', now: 43000 });
    expect(s).toEqual({ status: 'acknowledged', level: 3, since: 1000, at: 43000 });
  });
  it('raises a new alert when the level rises again, even after acknowledgement', () => {
    let s = ackReducer(none, lvl(3, 0));
    s = ackReducer(s, { type: 'acknowledge', now: 5000 });
    s = ackReducer(s, lvl(4, 9000));
    expect(s).toEqual({ status: 'pending', level: 4, since: 9000 });
  });
  it('keeps the alert while the level stays at 3 or above without rising', () => {
    let s = ackReducer(none, lvl(4, 0));
    s = ackReducer(s, lvl(3, 1000));
    expect(s).toEqual({ status: 'pending', level: 3, since: 0 });
    s = ackReducer(s, lvl(4, 2000));
    expect(s).toEqual({ status: 'pending', level: 4, since: 2000 });
  });
  it('clears when the level falls below 3, and on reset', () => {
    expect(ackReducer(ackReducer(none, lvl(3, 0)), lvl(2, 1))).toEqual(none);
    expect(ackReducer(ackReducer(none, lvl(4, 0)), { type: 'reset' })).toEqual(none);
  });
  it('ignores acknowledge when nothing is pending', () => {
    expect(ackReducer(none, { type: 'acknowledge', now: 1 })).toEqual(none);
  });
});

describe('formatElapsed', () => {
  it.each([[0, '0:00'], [42000, '0:42'], [61500, '1:01'], [600000, '10:00'], [-5, '0:00']] as const)(
    '%s ms → %s', (ms, s) => expect(formatElapsed(ms)).toBe(s));
});
