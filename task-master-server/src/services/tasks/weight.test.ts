import { calculateWeight, calculateWeightBreakdown, projectMultiplier, type WeightInput } from './weight';

/** Base input helper — a fresh high-priority task with no due date/projects. */
function input(overrides: Partial<WeightInput> = {}): WeightInput {
  const now = new Date('2026-06-15T12:00:00');
  return {
    createdAt: now,
    priority: 'high',
    dueDate: null,
    dueTime: null,
    isRepeatable: false,
    deferralCount: 0,
    projectPriorityOrder: null,
    totalProjects: 0,
    projectWeightingEnabled: false,
    now,
    ...overrides,
  };
}

describe('calculateWeight — base age + priority', () => {
  it('a task created today has weight = 1 × priority multiplier', () => {
    expect(calculateWeight(input({ priority: 'high' }))).toBe(3);
    expect(calculateWeight(input({ priority: 'medium' }))).toBe(2);
    expect(calculateWeight(input({ priority: 'low' }))).toBe(1);
  });

  it('age increases weight linearly with priority', () => {
    const now = new Date('2026-06-15T12:00:00');
    const created = new Date('2026-06-05T12:00:00'); // 10 days old
    expect(calculateWeight(input({ now, createdAt: created, priority: 'high' }))).toBe((10 + 1) * 3);
  });
});

describe('calculateWeight — due proximity (continuous)', () => {
  it('overdue adds days × 10', () => {
    const now = new Date('2026-06-15T12:00:00');
    // due 2 days ago
    const w = calculateWeight(input({ now, dueDate: '2026-06-13', dueTime: '12:00' }));
    // base 3 + overdue 2*10 = 23
    expect(w).toBe(23);
  });

  it('due within 7 days adds a continuous bonus', () => {
    const now = new Date('2026-06-15T12:00:00');
    // due in exactly 3 days at same time => hoursUntilDue = 72
    const w = calculateWeightBreakdown(input({ now, dueDate: '2026-06-18', dueTime: '12:00' }));
    // (7 - 72/24) * 5 = (7-3)*5 = 20
    expect(w.dueProximity).toBeCloseTo(20, 5);
  });

  it('same-day EARLIER due_time outweighs a later due_time', () => {
    const now = new Date('2026-06-15T08:00:00');
    const early = calculateWeight(input({ now, dueDate: '2026-06-15', dueTime: '09:00' }));
    const late = calculateWeight(input({ now, dueDate: '2026-06-15', dueTime: '23:00' }));
    expect(early).toBeGreaterThan(late);
  });

  it('no due_time defaults to end of day', () => {
    const now = new Date('2026-06-15T08:00:00');
    const noTime = calculateWeightBreakdown(input({ now, dueDate: '2026-06-15', dueTime: null }));
    const endOfDay = calculateWeightBreakdown(input({ now, dueDate: '2026-06-15', dueTime: '23:59' }));
    expect(noTime.dueProximity).toBeCloseTo(endOfDay.dueProximity, 1);
  });

  it('due more than 7 days away adds nothing', () => {
    const now = new Date('2026-06-15T12:00:00');
    const w = calculateWeightBreakdown(input({ now, dueDate: '2026-06-30', dueTime: '12:00' }));
    expect(w.dueProximity).toBe(0);
  });
});

describe('calculateWeight — project multiplier', () => {
  it('single project doubles (×(1+1.0))', () => {
    const w = calculateWeight(
      input({ projectWeightingEnabled: true, projectPriorityOrder: 1, totalProjects: 1 }),
    );
    // base 3 × (1 + 1.0) = 6
    expect(w).toBe(6);
  });

  it('projectMultiplier distributes linearly across N projects', () => {
    expect(projectMultiplier(1, 4)).toBeCloseTo(1.0);
    expect(projectMultiplier(2, 4)).toBeCloseTo(2 / 3, 5);
    expect(projectMultiplier(4, 4)).toBeCloseTo(0.0);
  });

  it('disabled project weighting has no effect', () => {
    const w = calculateWeight(
      input({ projectWeightingEnabled: false, projectPriorityOrder: 1, totalProjects: 4 }),
    );
    expect(w).toBe(3);
  });

  it('unassigned task (null order) has no project effect', () => {
    const w = calculateWeight(
      input({ projectWeightingEnabled: true, projectPriorityOrder: null, totalProjects: 4 }),
    );
    expect(w).toBe(3);
  });
});

describe('calculateWeight — deferrals and repeatable', () => {
  it('adds 5 per deferral', () => {
    expect(calculateWeight(input({ deferralCount: 3 }))).toBe(3 + 15);
  });

  it('repeatable due today roughly doubles the accumulated weight', () => {
    const now = new Date('2026-06-15T08:00:00');
    const normal = calculateWeightBreakdown(input({ now, dueDate: '2026-06-15', isRepeatable: false }));
    const repeat = calculateWeightBreakdown(input({ now, dueDate: '2026-06-15', isRepeatable: true }));
    // The repeatable "repeatable" contribution equals the pre-double subtotal,
    // so total ≈ 2× the non-repeatable total (within rounding).
    expect(repeat.total).toBeGreaterThanOrEqual(normal.total * 2 - 1);
    expect(repeat.total).toBeLessThanOrEqual(normal.total * 2 + 1);
    expect(repeat.repeatable).toBeGreaterThan(0);
  });

  it('repeatable NOT due today is not doubled', () => {
    const now = new Date('2026-06-15T08:00:00');
    const repeat = calculateWeightBreakdown(input({ now, dueDate: '2026-06-20', isRepeatable: true }));
    expect(repeat.repeatable).toBe(0);
  });
});

describe('calculateWeight — misc', () => {
  it('no due date applies only age/priority/project/deferral', () => {
    const w = calculateWeightBreakdown(input({ deferralCount: 2 }));
    expect(w.dueProximity).toBe(0);
    expect(w.total).toBe(3 + 10);
  });

  it('is deterministic for identical inputs', () => {
    expect(calculateWeight(input())).toBe(calculateWeight(input()));
  });

  it('returns a rounded integer total', () => {
    const w = calculateWeight(input({ now: new Date('2026-06-15T12:00:00'), dueDate: '2026-06-17', dueTime: '15:30' }));
    expect(Number.isInteger(w)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feature: user-timezone — timezone-aware weight behavior (Tasks 12.1 & 12.2)
// ---------------------------------------------------------------------------

import fc from 'fast-check';
import { localCalendarDate } from '../time/userTime';

/** Curated zones spanning the UTC-offset extremes plus the baseline. */
const TIMEZONES = ['Asia/Tokyo', 'UTC', 'America/New_York', 'Pacific/Kiritimati'];

/** Arbitrary that builds a reasonable WeightInput for a fixed injected `now`. */
function weightInputArb(now: Date): fc.Arbitrary<WeightInput> {
  return fc.record({
    // createdAt within roughly ±20 days of `now`.
    createdAt: fc
      .integer({ min: -20, max: 5 })
      .map((days) => new Date(now.getTime() + days * 86_400_000)),
    priority: fc.constantFrom<'high' | 'medium' | 'low'>('high', 'medium', 'low'),
    // dueDate sometimes null, sometimes a date string near `now`.
    dueDate: fc.option(
      fc
        .integer({ min: -10, max: 20 })
        .map((days) => localCalendarDate('UTC', new Date(now.getTime() + days * 86_400_000))),
      { nil: null },
    ),
    dueTime: fc.option(
      fc
        .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
        .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
      { nil: null },
    ),
    isRepeatable: fc.boolean(),
    deferralCount: fc.integer({ min: 0, max: 10 }),
    projectPriorityOrder: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
    totalProjects: fc.integer({ min: 0, max: 5 }),
    projectWeightingEnabled: fc.boolean(),
  }).map((r) => ({ ...r, now }) as WeightInput);
}

describe('calculateWeight — timezone properties', () => {
  // Feature: user-timezone, Property 7: UTC (or unset) timezone reproduces the pre-change baseline weight
  it('Property 7: unset localToday equals localToday = localCalendarDate("UTC", now)', () => {
    const now = new Date('2026-06-15T12:00:00');
    fc.assert(
      fc.property(weightInputArb(now), (base) => {
        const utcToday = localCalendarDate('UTC', now);
        const unset = calculateWeight({ ...base, localToday: undefined });
        const explicitUtc = calculateWeight({ ...base, localToday: utcToday });
        expect(unset).toBe(explicitUtc);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: user-timezone, Property 8: repeatable-due-today follows the user's local calendar day
  it('Property 8: repeatable doubling applies iff dueDate === localCalendarDate(tz, now)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TIMEZONES),
        // Arbitrary valid instant across a wide range so zones diverge on the calendar day.
        fc.date({
          min: new Date('2020-01-01T00:00:00Z'),
          max: new Date('2035-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        // dueDate near the instant so "due today" is sometimes true, sometimes false.
        fc.integer({ min: -3, max: 3 }),
        (tz, now, offsetDays) => {
          const localToday = localCalendarDate(tz, now);
          // Build a dueDate around the instant (in the same zone) to hit both branches.
          const dueDate = localCalendarDate(tz, new Date(now.getTime() + offsetDays * 86_400_000));

          const base = input({
            now,
            createdAt: now,
            dueDate,
            dueTime: null,
            localToday,
          });

          const repeat = calculateWeight({ ...base, isRepeatable: true });
          const nonRepeat = calculateWeight({ ...base, isRepeatable: false });

          const dueToday = dueDate === localToday;
          if (dueToday) {
            // Doubling adds a strictly positive subtotal (base ≥ 1 always).
            expect(repeat).toBeGreaterThan(nonRepeat);
          } else {
            expect(repeat).toBe(nonRepeat);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('calculateWeight — Tokyo vs UTC boundary (Task 12.2)', () => {
  it('a repeatable task doubles for Tokyo but not for UTC at a day-boundary instant', () => {
    // 2026-06-14T20:00Z → Tokyo (UTC+9) is 2026-06-15 05:00, UTC is 2026-06-14.
    const now = new Date('2026-06-14T20:00:00Z');
    expect(localCalendarDate('Asia/Tokyo', now)).toBe('2026-06-15');
    expect(localCalendarDate('UTC', now)).toBe('2026-06-14');

    const base = input({
      now,
      createdAt: now,
      dueDate: '2026-06-15', // the Tokyo local date
      dueTime: null,
      isRepeatable: true,
    });

    const tokyo = calculateWeightBreakdown({
      ...base,
      localToday: localCalendarDate('Asia/Tokyo', now),
    });
    const utc = calculateWeightBreakdown({
      ...base,
      localToday: localCalendarDate('UTC', now),
    });

    // Due today in Tokyo → doubling applied.
    expect(tokyo.repeatable).toBeGreaterThan(0);
    // Not due today in UTC → no doubling.
    expect(utc.repeatable).toBe(0);
    // The zone label alone changes the outcome.
    expect(tokyo.total).toBeGreaterThan(utc.total);
  });
});
