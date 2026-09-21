import { query } from '../database/pool';

/** Read-only aggregation for project analytics. No writes live here. */

/** One aggregated completion-stats row per Owned_Project (DB shape). */
export interface ProjectCompletionStatsRow {
  id: string;
  name: string;
  priority_order: number;
  color: string | null;
  tasks_completed: number; // ::int
  weight_completed: number; // ::int (COALESCE sum, null->0)
  last_completed_at: Date | null; // MAX(completed_at) instant, or null
}

/**
 * Aggregate completed-task counts, summed completion weight, and the latest
 * completion instant for every project owned by `userId`, ordered by
 * `priority_order` ascending.
 *
 * The Completed_Task predicate (`completed_at IS NOT NULL`, `archived_at IS
 * NULL`, `user_id = $1`) lives in the `LEFT JOIN ... ON` clause rather than a
 * `WHERE`. This is deliberate (DD-1): keeping it in the join preserves every
 * owned project even when it has no matching completions, so an empty project
 * still returns a row with `tasks_completed = 0`, `weight_completed = 0`, and
 * `last_completed_at = NULL`. Moving the predicate into a `WHERE` would drop
 * those empty projects.
 *
 * Because the aggregate groups over the `task_projects` join, a task that
 * belongs to N projects is counted in each of those N project groups (DD-2);
 * cross-project totals may therefore exceed the distinct completed-task count.
 *
 * The `::int` casts make `pg` return `tasks_completed`/`weight_completed` as JS
 * numbers; `last_completed_at` comes back as a JS `Date` (or null) and is
 * converted to the user-local calendar day by the service, not here.
 */
export async function projectCompletionStats(
  userId: string,
): Promise<ProjectCompletionStatsRow[]> {
  const res = await query<ProjectCompletionStatsRow>(
    `SELECT
       p.id, p.name, p.priority_order, p.color,
       COUNT(t.id)::int AS tasks_completed,
       COALESCE(SUM(t.weight_at_completion), 0)::int AS weight_completed,
       MAX(t.completed_at) AS last_completed_at
     FROM projects p
     LEFT JOIN task_projects tp ON tp.project_id = p.id
     LEFT JOIN tasks t
       ON t.id = tp.task_id
       AND t.user_id = $1
       AND t.completed_at IS NOT NULL
       AND t.archived_at IS NULL
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.priority_order ASC`,
    [userId],
  );
  return res.rows;
}
