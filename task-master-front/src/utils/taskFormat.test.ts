import { describe, it, expect } from 'vitest';
import { formatDue, priorityLabel } from './taskFormat';

describe('priorityLabel', () => {
  it('maps priorities to capitalized labels', () => {
    expect(priorityLabel('high')).toBe('High');
    expect(priorityLabel('medium')).toBe('Medium');
    expect(priorityLabel('low')).toBe('Low');
  });
});

describe('formatDue', () => {
  it('returns null when there is no due date', () => {
    expect(formatDue(null, null)).toBeNull();
    expect(formatDue(null, '09:00')).toBeNull();
  });

  it('formats a date without time', () => {
    expect(formatDue('2026-03-05', null)).toBe('Mar 5');
  });

  it('formats a date with time (HH:MM)', () => {
    expect(formatDue('2026-03-05', '14:30')).toBe('Mar 5, 14:30');
  });

  it('trims seconds from HH:MM:SS', () => {
    expect(formatDue('2026-03-05', '14:30:00')).toBe('Mar 5, 14:30');
  });
});
