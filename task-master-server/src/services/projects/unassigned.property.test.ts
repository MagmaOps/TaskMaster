import fc from 'fast-check';
import { pool } from '../../database/pool';
import * as taskRepo from '../../repositories/taskRepository';
import * as projectRepo from '../../repositories/projectRepository';
import { calculateWeight, type Priority, type WeightInput } from '../tasks/weight';

/**
 * DB-backed + pure property tests for the Unassigned (default) project revision
 * of the projects-management spec. Covers design.md "## Correctness Properties":
 *
 *   - Property 1: Unassigned membership is exclusive and total.
 *   - Property 2: Unassigned is weight-neutral.
 *
 * Both properties run a minimum of 100 fast-check iterations.
 *
 * ISOLATION NOTE: the global setupAfterEnv TRUNCATEs every data table
 * (RESTART IDENTITY CASCADE) before EACH `it` block, but NOT between fast-check
 * runs within one `it`. Property 1 therefore creates a FRESH user per run (a
 * unique email seeded from an fc-generated suffix) and calls
 * projectRepo.ensureDefault for that user, so every run's rows are fully
 * independent of every other run's.
 *
 * ENVIRONMENT NOTE: assertion queries read is_default (boolean) directly and use
 * ::int / boolean getters rather than DATE columns, avoiding the pg
 * Date-object ambiguity called out in the task.
 */

// -- Property 1 helpers -------------------------------------------------------

/** Create a fresh user (unique email) and ensure its Unassigned project exists. */
async function freshUserWithDefault(
  suffix: string,
): Promise<{ userId: string; defaultId: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, NULL) RETURNING id`,
    [`unassigned-prop-${suffix}@example.com`],
  );
  const userId = res.rows[0].id;
  const def = await projectRepo.ensureDefault(userId);
  return { userId, defaultId: def.id };
}

interface Membership {
  projectId: string;
  isDefault: boolean;
}

/** The task's project memberships joined to projects.is_default. */
async function membershipsOf(taskId: string): Promise<Membership[]> {
  const res = await pool.query<{ project_id: string; is_default: boolean }>(
    `SELECT tp.project_id, p.is_default
       FROM task_projects tp
       JOIN projects p ON p.id = tp.project_id
      WHERE tp.task_id = $1`,
    [taskId],
  );
  return res.rows.map((r) => ({ projectId: r.project_id, isDefault: r.is_default }));
}

/**
 * Assert the exclusive-and-total invariant given how many Real_Projects were
 * assigned and which project is the Unassigned one.
 *   - K == 0 -> exactly one membership, and it IS the default (Unassigned only).
 *   - K >= 1 -> exactly K memberships, NONE default (Real_Projects only).
 * Never both, never empty.
 */
function assertInvariant(memberships: Membership[], realIds: string[], defaultId: string): void {
  const realCount = realIds.length;
  // Never empty.
  expect(memberships.length).toBeGreaterThan(0);
  if (realCount === 0) {
    // Unassigned only.
    expect(memberships).toHaveLength(1);
    expect(memberships[0].isDefault).toBe(true);
    expect(memberships[0].projectId).toBe(defaultId);
  } else {
    // Real_Projects only, exactly K, none default, no Unassigned present.
    expect(memberships).toHaveLength(realCount);
    expect(memberships.every((m) => m.isDefault === false)).toBe(true);
    expect(memberships.some((m) => m.projectId === defaultId)).toBe(false);
    const got = memberships.map((m) => m.projectId).sort();
    expect(got).toEqual([...realIds].sort());
  }
}

const priorityArb: fc.Arbitrary<Priority> = fc.constantFrom('high', 'medium', 'low');

describe('Unassigned project — Property 1 (membership exclusive + total)', () => {
  // Feature: projects-management, Property 1: For any task, its project set is
  // either one-or-more Real_Projects (and no Unassigned membership) or exactly
  // the Unassigned project (when it has no Real_Project) — never both, and never
  // empty.
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.6
  it('create + update always land in Real_Projects-only or Unassigned-only, never both/empty (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // per-run unique user suffix => run isolation
        // Initial assignment: 0..3 Real_Projects (names chosen to be distinct).
        fc.integer({ min: 0, max: 3 }),
        // Second assignment (update) size: 0..3 Real_Projects (may toggle to empty).
        fc.integer({ min: 0, max: 3 }),
        priorityArb,
        async (suffix, kInitial, kUpdate, priority) => {
          const { userId, defaultId } = await freshUserWithDefault(suffix);

          // Create the pool of Real_Projects needed for the larger of the two
          // sizes, then slice for each phase.
          const need = Math.max(kInitial, kUpdate);
          const allReal: string[] = [];
          for (let i = 0; i < need; i++) {
            const p = await projectRepo.create(userId, { name: `P${i}-${suffix}` });
            allReal.push(p.id);
          }

          const initialReal = allReal.slice(0, kInitial);

          // CREATE with the initial Real_Project set (empty when kInitial === 0).
          const task = await taskRepo.create(userId, {
            subject: 'membership-prop',
            priority,
            projectIds: initialReal,
          });
          assertInvariant(await membershipsOf(task.id), initialReal, defaultId);

          // UPDATE to a different set (a different slice, possibly empty).
          const updateReal = allReal.slice(0, kUpdate);
          await taskRepo.update(userId, task.id, { projectIds: updateReal });
          assertInvariant(await membershipsOf(task.id), updateReal, defaultId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// -- Property 2 ---------------------------------------------------------------

/** A valid 'YYYY-MM-DD' string (day 1..28 keeps it valid for every month). */
const ymdArb: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 2020, max: 2030 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, m, d }) =>
      `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

const dueDateArb: fc.Arbitrary<string | null> = fc.option(ymdArb, { nil: null });

/** Random WeightInput with projectPriorityOrder pinned to null (Unassigned-excluded). */
const nullOrderInputArb: fc.Arbitrary<Omit<WeightInput, 'totalProjects'>> = fc.record({
  // Build createdAt from a valid 'YYYY-MM-DD' at UTC noon — always a valid Date
  // (fc.date() can yield boundary values whose toISOString throws).
  createdAt: ymdArb.map((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }),
  priority: priorityArb,
  dueDate: dueDateArb,
  dueTime: fc.option(fc.constantFrom('00:00', '09:30', '18:45', '23:59'), { nil: null }),
  isRepeatable: fc.boolean(),
  deferralCount: fc.integer({ min: 0, max: 10 }),
  projectPriorityOrder: fc.constant<number | null>(null),
  projectWeightingEnabled: fc.boolean(),
  now: fc.constant(new Date('2024-06-15T12:00:00Z')),
});

describe('Unassigned project — Property 2 (weight-neutral)', () => {
  // Feature: projects-management, Property 2: For any task whose only membership
  // is the Unassigned project, its computed weight equals the weight of an
  // otherwise-identical task with no project at all (the multiplier block is
  // skipped), and the presence of the Unassigned project never changes any
  // Real_Project task weight.
  // Validates: Requirements 11.2, 11.3, 11.4
  //
  // The weight path excludes is_default projects from orderById/totalProjects
  // (taskService.loadUserWeightContext), so an Unassigned-only task yields
  // projectPriorityOrder = null exactly like a no-project task. This encodes the
  // property purely at weight.ts: with projectPriorityOrder = null, weight is
  // independent of totalProjects (the Unassigned project's presence/count never
  // shifts weight). We assert equality across a wide range of totalProjects for
  // the same otherwise-identical input.
  it('projectPriorityOrder=null makes weight independent of totalProjects (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        nullOrderInputArb,
        // Two arbitrary "project count" states: e.g. no-project (0) vs. having an
        // Unassigned project present (and any number of others). Both must be
        // identical in weight because a null order skips the multiplier block.
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        async (base, totalA, totalB) => {
          const withA: WeightInput = { ...base, totalProjects: totalA };
          const withB: WeightInput = { ...base, totalProjects: totalB };
          expect(calculateWeight(withA)).toBe(calculateWeight(withB));
        },
      ),
      { numRuns: 100 },
    );
  });
});
