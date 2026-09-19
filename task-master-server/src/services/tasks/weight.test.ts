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
