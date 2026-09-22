import { describe, it, expect } from 'vitest';
import { celebrationMessage } from './achievementCopy';

describe('celebrationMessage', () => {
  it('uses exact copy for known fixed types', () => {
    expect(celebrationMessage({ type: 'first_task_completed' })).toMatch(/first task done/i);
    expect(celebrationMessage({ type: 'accountable_procrastination' })).toMatch(/counts double/i);
    expect(celebrationMessage({ type: 'productivity_burst_10' })).toMatch(/10 done/i);
    expect(celebrationMessage({ type: 'high_weight_completed' })).toMatch(/heavy/i);
  });

  it('derives streak copy with the day count', () => {
    expect(celebrationMessage({ type: 'daily_streak_7' })).toMatch(/7-day streak/i);
    expect(celebrationMessage({ type: 'daily_streak_30' })).toMatch(/30-day streak/i);
    expect(celebrationMessage({ type: 'repeatable_streak_100' })).toMatch(/100 in a row/i);
  });

  it('falls back to a generic cheer for unknown types', () => {
    expect(celebrationMessage({ type: 'some_future_badge' })).toMatch(/achievement unlocked/i);
  });
});
