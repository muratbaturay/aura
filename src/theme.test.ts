import { describe, it, expect } from 'vitest';
import { DEFAULT_BASELINE } from './baseline';
import { themeFor, partOfDay } from './theme';

describe('themeFor', () => {
  it.each([[21.5, 'day'], [22, 'night'], [3, 'night'], [5.9, 'night'], [6, 'day'], [14, 'day']] as const)(
    'hour %s → %s', (h, t) => expect(themeFor(h, DEFAULT_BASELINE)).toBe(t));
});

describe('partOfDay', () => {
  it.each([[5, 'Morning'], [11.9, 'Morning'], [12, 'Afternoon'], [16.5, 'Afternoon'], [17, 'Evening'],
    [21.9, 'Evening'], [22, 'Night'], [4, 'Night'], [24, 'Night']] as const)(
    'hour %s → %s', (h, p) => expect(partOfDay(h)).toBe(p));
});
