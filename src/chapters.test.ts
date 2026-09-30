import { describe, it, expect } from 'vitest';
import { levelChapters, chaptersView } from './chapters';

describe('levelChapters', () => {
  it('starts a chapter at hour 0 and at each level change', () => {
    expect(levelChapters([1, 1, 2, 2, 3, 3, 1, 1])).toEqual([
      { hour: 0, title: 'Calm' }, { hour: 2, title: 'Gentle prompt' },
      { hour: 4, title: 'Staff soft alert' }, { hour: 6, title: 'Calm' },
    ]);
  });
  it('keeps hour 0 and the three highest-level changes when there are more than four', () => {
    const ch = levelChapters([1, 2, 1, 3, 1, 4, 1, 2]);
    expect(ch.map(c => c.hour)).toEqual([0, 1, 3, 5]);
  });
});

describe('chaptersView', () => {
  const ch = [{ hour: 0, title: 'A' }, { hour: 5, title: 'B' }, { hour: 9, title: 'C' }];
  it('marks past, now and upcoming chapters with HH:00 labels', () => {
    expect(chaptersView(ch, 6)).toEqual([
      { hour: 0, title: 'A', timeLabel: '00:00', status: 'past' },
      { hour: 5, title: 'B', timeLabel: '05:00', status: 'now' },
      { hour: 9, title: 'C', timeLabel: '09:00', status: 'upcoming' },
    ]);
  });
  it('has no current chapter before the first one starts', () => {
    expect(chaptersView([{ hour: 3, title: 'A' }], 1)[0].status).toBe('upcoming');
  });
});
