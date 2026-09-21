import fc from 'fast-check';
import { pool } from '../database/pool';
import * as projectRepo from './projectRepository';
import * as taskRepo from './taskRepository';
import { projectCompletionStats } from './analyticsRepository';
import { getProjectAnalytics } from '../services/analytics/analyticsService';
import { localCalendarDate } from '../services/time/userTime';

/**
 * DB-backed property tests for analytics against the integration Postgres
 * (migrated by Jest globalSetup; tables TRUNCATEd between `it` blocks by
 * setupAfterEnv). Covers design.md "## Correctness Properties" (Properties 1-5),
 * each a SINGLE fast-check property running a minimum of 100 iterations.
 *
 * Units under test:
 *   - analyticsRepository.projectCompletionStats(userId) — the aggregate (P1-P4)
 *   - analyticsService.getProjectAnalytics(userId)        — tz -> lastCompletionDate (P5)
 *
 * ISOLATION: truncation runs BETWEEN `it` blocks, NOT between fast-check runs.
 * Each run therefore creates a FRESH user (unique email from an fc uuid suffix)
 * and its Unassigned project via projectRepo.ensureDefault, so every run's rows
 * are fully independent of every other run's.
 *
 * DATE SAFETY: instants are built from integer epoch-ms (safe range) via
 * `new Date(ms)` — never `fc.date().toISOString()`, which can throw
 * `RangeError: Invalid time value` on boundary values under some seeds.
 */

// A safe epoch-ms range (2020-01-01 .. 2030-12-31, UTC) — always a valid Date.
const MS_MIN = Date.UTC(2020, 0, 1);
const MS_MAX = Date.UTC(2030, 11, 31);

/** Create a fresh user (unique email) and ensure its Unassigned project exists. */
async function freshUser(suffix: string): Promise<{ userId: string; defaultId: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, NULL) RETURNING id`,
    [`analytics-prop-${suffix}@example.com`],
  );
  const userId = res.rows[0].id;
  const def = await projectRepo.ensureDefault(userId);
  return { userId, defaultId: def.id };
}

/**
 * Seed a COMPLETED, non-archived task assigned to `projectIds` (Real_Projects),
 * setting its `completed_at` instant and `weight_at_completion` directly for
 * deterministic control. `weight` of null seeds a NULL weight_at_completion.
 */
async function seedCompleted(
  userId: string,
  projectIds: string[],
  weight: number | null,
  completedAt: Date,
): Promise<string> {
  const task = await taskRepo.create(userId, {
    subject: 'seed',
    priority: 'medium',
    projectIds,
  });
  await pool.query(
    `UPDATE tasks SET completed_at = $2, weight_at_completion = $3 WHERE id = $1`,
    [task.id, completedAt, weight],
  );
  return task.id;
}

/** Seed an ACTIVE (not completed, not archived) task assigned to `projectIds`. */
async function seedActive(userId: string, projectIds: string[]): Promise<string> {
  const task = await taskRepo.create(userId, {
    subject: 'active',
    priority: 'medium',
    projectIds,
  });
  return task.id;
}

/**
 * Seed an ARCHIVED task assigned to `projectIds`. When `completed` it is also
 * marked completed (archived-completed must still be excluded).
 */
async function seedArchived(
  userId: string,
  projectIds: string[],
  completed: boolean,
): Promise<string> {
  const task = await taskRepo.create(userId, {
    subject: 'archived',
    priority: 'medium',
    projectIds,
  });
  await pool.query(
    `UPDATE tasks
       SET archived_at = NOW(),
           completed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
           weight_at_completion = CASE WHEN $2 THEN 100 ELSE NULL END
     WHERE id = $1`,
    [task.id, completed],
  );
  return task.id;
}

/** Find the aggregated row for a given project id. */
function rowFor<T extends { id: string }>(rows: T[], id: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row for project ${id}`);
  return row;
}

describe('analytics — Property 1 (count and weight match seeded completions)', () => {
  // Feature: analytics, Property 1: For any set of completed tasks seeded across a
  // project, tasksCompleted equals the number of that project's completed,
  // non-archived tasks and weightCompleted equals the sum of their
  // weight_at_completion (null treated as 0).
  // Validates: Requirements 1.2, 1.3, 1.5
  it('tasks_completed == N and weight_completed == sum(weights, null->0) (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Per completed task: a weight (0..500) or null.
        fc.array(fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }), {
          minLength: 0,
          maxLength: 6,
        }),
        fc.integer({ min: MS_MIN, max: MS_MAX }),
        async (suffix, weights, ms) => {
          const { userId } = await freshUser(suffix);
          const project = await projectRepo.create(userId, { name: `P-${suffix}` });

          for (const w of weights) {
            await seedCompleted(userId, [project.id], w, new Date(ms));
          }

          const rows = await projectCompletionStats(userId);
          const row = rowFor(rows, project.id);

          const expectedWeight = weights.reduce<number>((acc, w) => acc + (w ?? 0), 0);
          expect(row.tasks_completed).toBe(weights.length);
          expect(row.weight_completed).toBe(expectedWeight);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('analytics — Property 2 (only completed, non-archived, owned tasks contribute)', () => {
  // Feature: analytics, Property 2: For any mix of active, archived, and other-user
  // tasks in a project, none of them affect tasksCompleted or weightCompleted —
  // only the requesting user's completed, non-archived tasks do.
  // Validates: Requirements 1.5, 5.2
  it('active/archived/other-user tasks never count; only owner completed non-archived do (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 0, max: 4 }), // completed non-archived (should count)
        fc.integer({ min: 0, max: 4 }), // active (should NOT count)
        fc.integer({ min: 0, max: 4 }), // archived, completed==false (should NOT count)
        fc.integer({ min: 0, max: 4 }), // archived, completed==true (should NOT count)
        fc.integer({ min: 0, max: 500 }), // weight for each counted task
        fc.integer({ min: MS_MIN, max: MS_MAX }),
        async (suffix, nCompleted, nActive, nArchived, nArchivedDone, weight, ms) => {
          const { userId } = await freshUser(suffix);
          const project = await projectRepo.create(userId, { name: `P-${suffix}` });

          for (let i = 0; i < nCompleted; i++) {
            await seedCompleted(userId, [project.id], weight, new Date(ms));
          }
          for (let i = 0; i < nActive; i++) {
            await seedActive(userId, [project.id]);
          }
          for (let i = 0; i < nArchived; i++) {
            await seedArchived(userId, [project.id], false);
          }
          for (let i = 0; i < nArchivedDone; i++) {
            await seedArchived(userId, [project.id], true);
          }

          // A SECOND user with their own completed task in THEIR own project.
          const { userId: otherId } = await freshUser(`${suffix}-other`);
          const otherProject = await projectRepo.create(otherId, { name: `OP-${suffix}` });
          await seedCompleted(otherId, [otherProject.id], 999, new Date(ms));

          const rows = await projectCompletionStats(userId);
          const row = rowFor(rows, project.id);

          expect(row.tasks_completed).toBe(nCompleted);
          expect(row.weight_completed).toBe(nCompleted * weight);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('analytics — Property 3 (multi-project completions counted per project)', () => {
  // Feature: analytics, Property 3: For any completed task associated with several
  // projects, its count and weight appear in each of those projects' rows (DD-2).
  // Validates: Requirements 1.4
  it('one completed task in K projects counts (1, weight) in every one of them (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: MS_MIN, max: MS_MAX }),
        async (suffix, k, weight, ms) => {
          const { userId } = await freshUser(suffix);
          const projectIds: string[] = [];
          for (let i = 0; i < k; i++) {
            const p = await projectRepo.create(userId, { name: `P${i}-${suffix}` });
            projectIds.push(p.id);
          }

          // ONE completed task assigned to all K projects.
          await seedCompleted(userId, projectIds, weight, new Date(ms));

          const rows = await projectCompletionStats(userId);
          for (const pid of projectIds) {
            const row = rowFor(rows, pid);
            expect(row.tasks_completed).toBe(1);
            expect(row.weight_completed).toBe(weight);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('analytics — Property 4 (every owned project appears once, empty projects zeroed)', () => {
  // Feature: analytics, Property 4: For any set of owned projects, the response
  // contains exactly one row per project (ordered by priority_order), and a
  // project with no completed tasks has tasksCompleted = 0, weightCompleted = 0,
  // lastCompletionDate = null.
  // Validates: Requirements 1.1, 3.1, 4.1
  it('exactly one row per project, priority_order-ordered, empties zeroed (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 5 }), // M Real_Projects
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: MS_MIN, max: MS_MAX }),
        // Bitmask deciding which of the M projects receive a completed task.
        fc.integer({ min: 0, max: 31 }),
        async (suffix, m, weight, ms, mask) => {
          const { userId, defaultId } = await freshUser(suffix);
          const projectIds: string[] = [];
          for (let i = 0; i < m; i++) {
            const p = await projectRepo.create(userId, { name: `P${i}-${suffix}` });
            projectIds.push(p.id);
          }

          // Assign a completed task to SOME (bitmask-selected) projects only.
          const filledIds = new Set<string>();
          for (let i = 0; i < m; i++) {
            if ((mask >> i) & 1) {
              await seedCompleted(userId, [projectIds[i]], weight, new Date(ms));
              filledIds.add(projectIds[i]);
            }
          }

          const rows = await projectCompletionStats(userId);

          // Non-default rows must equal exactly the M Real_Projects.
          const nonDefault = rows.filter((r) => r.id !== defaultId);
          expect(nonDefault).toHaveLength(m);
          const gotIds = nonDefault.map((r) => r.id).sort();
          expect(gotIds).toEqual([...projectIds].sort());

          // The Unassigned project also appears (exactly once) — total = M + 1.
          expect(rows.filter((r) => r.id === defaultId)).toHaveLength(1);
          expect(rows).toHaveLength(m + 1);

          // Ordering by priority_order ascending across ALL rows.
          const orders = rows.map((r) => r.priority_order);
          expect(orders).toEqual([...orders].sort((a, b) => a - b));

          // Empty projects zeroed; filled projects have the seeded completion.
          for (const pid of projectIds) {
            const row = rowFor(rows, pid);
            if (filledIds.has(pid)) {
              expect(row.tasks_completed).toBe(1);
              expect(row.weight_completed).toBe(weight);
              expect(row.last_completed_at).not.toBeNull();
            } else {
              expect(row.tasks_completed).toBe(0);
              expect(row.weight_completed).toBe(0);
              expect(row.last_completed_at).toBeNull();
            }
          }

          // The (empty) Unassigned project is zeroed too.
          const defRow = rowFor(rows, defaultId);
          expect(defRow.tasks_completed).toBe(0);
          expect(defRow.weight_completed).toBe(0);
          expect(defRow.last_completed_at).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('analytics — Property 5 (last completion date is the local day of the latest completion)', () => {
  // Feature: analytics, Property 5: For any project with completions,
  // lastCompletionDate equals localCalendarDate(tz, MAX(completed_at)) — the
  // user-zone calendar day of the latest completion instant — and is null exactly
  // when the project has no completions.
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it('lastCompletionDate == localCalendarDate(tz, max instant); null when no completions (fast-check, >= 100 runs)', async () => {
    // A fixed non-UTC zone for extra coverage; the oracle uses the SAME tz.
    const tz = 'America/New_York';
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // Several completion instants (epoch-ms); may be empty.
        fc.array(fc.integer({ min: MS_MIN, max: MS_MAX }), { minLength: 0, maxLength: 5 }),
        async (suffix, msList) => {
          const { userId } = await freshUser(suffix);
          // Give the user a non-UTC timezone; oracle uses the same tz.
          await pool.query(
            `UPDATE users SET settings = jsonb_set(settings, '{timezone}', to_jsonb($2::text)) WHERE id = $1`,
            [userId, tz],
          );

          const withCompletions = await projectRepo.create(userId, { name: `PC-${suffix}` });
          const empty = await projectRepo.create(userId, { name: `PE-${suffix}` });

          for (const ms of msList) {
            await seedCompleted(userId, [withCompletions.id], 10, new Date(ms));
          }

          const analytics = await getProjectAnalytics(userId);

          const withRow = analytics.find((a) => a.projectId === withCompletions.id);
          const emptyRow = analytics.find((a) => a.projectId === empty.id);
          expect(withRow).toBeDefined();
          expect(emptyRow).toBeDefined();

          // Empty project -> null date.
          expect(emptyRow!.lastCompletionDate).toBeNull();

          if (msList.length === 0) {
            expect(withRow!.lastCompletionDate).toBeNull();
          } else {
            const maxMs = Math.max(...msList);
            const expected = localCalendarDate(tz, new Date(maxMs));
            expect(withRow!.lastCompletionDate).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
