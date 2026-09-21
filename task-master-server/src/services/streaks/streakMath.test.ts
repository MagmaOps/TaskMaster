import { advanceStreak, StreakState } from './streakMath';

describe('advanceStreak', () => {
  // _Requirements: 1.2_
  it('starts a fresh streak when there is no prior state (prev null)', () => {
    expect(advanceStreak(null, '2026-06-15')).toEqual({
      current: 1,
      longest: 1,
      lastCompletedDate: '2026-06-15',
    });
  });

  // _Requirements: 1.2_
  it('starts a fresh streak when prev.lastCompletedDate is null', () => {
    const prev: StreakState = { current: 0, longest: 0, lastCompletedDate: null };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 1,
      longest: 1,
      lastCompletedDate: '2026-06-15',
    });
  });

  // _Requirements: 5.3_ (idempotent same-day)
  it('is a no-op on a same-day completion (current/longest unchanged)', () => {
    const prev: StreakState = { current: 4, longest: 9, lastCompletedDate: '2026-06-15' };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 4,
      longest: 9,
      lastCompletedDate: '2026-06-15',
    });
  });

  // _Requirements: 1.3_
  it('increments current and updates longest when yesterday', () => {
    const prev: StreakState = { current: 3, longest: 3, lastCompletedDate: '2026-06-14' };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 4,
      longest: 4,
      lastCompletedDate: '2026-06-15',
    });
  });

  // _Requirements: 1.3_
  it('updates longest when the incremented current exceeds it', () => {
    const prev: StreakState = { current: 5, longest: 5, lastCompletedDate: '2026-06-14' };
    const next = advanceStreak(prev, '2026-06-15');
    expect(next.current).toBe(6);
    expect(next.longest).toBe(6);
  });

  // _Requirements: 1.3_
  it('preserves longest when it is already higher than the new current', () => {
    const prev: StreakState = { current: 2, longest: 10, lastCompletedDate: '2026-06-14' };
    const next = advanceStreak(prev, '2026-06-15');
    expect(next.current).toBe(3);
    expect(next.longest).toBe(10);
  });

  // _Requirements: 1.4_
  it('resets current to 1 on a gap of more than one day, preserving longest', () => {
    const prev: StreakState = { current: 7, longest: 7, lastCompletedDate: '2026-06-10' };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 1,
      longest: 7,
      lastCompletedDate: '2026-06-15',
    });
  });

  // _Requirements: 1.3_ (month/year boundary, DST-safe via nextCalendarDate)
  it('increments across a month boundary (2026-06-30 → 2026-07-01)', () => {
    const prev: StreakState = { current: 2, longest: 2, lastCompletedDate: '2026-06-30' };
    expect(advanceStreak(prev, '2026-07-01')).toEqual({
      current: 3,
      longest: 3,
      lastCompletedDate: '2026-07-01',
    });
  });

  // _Requirements: 1.3_ (year boundary)
  it('increments across a year boundary (2026-12-31 → 2027-01-01)', () => {
    const prev: StreakState = { current: 4, longest: 4, lastCompletedDate: '2026-12-31' };
    expect(advanceStreak(prev, '2027-01-01')).toEqual({
      current: 5,
      longest: 5,
      lastCompletedDate: '2027-01-01',
    });
  });

  // _Requirements: 1.4, 1.5_ (backwards/past date treated as a gap)
  it('treats a backwards date as a gap (reset to 1, longest preserved)', () => {
    const prev: StreakState = { current: 6, longest: 8, lastCompletedDate: '2026-06-20' };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 1,
      longest: 8,
      lastCompletedDate: '2026-06-15',
    });
  });
});
