import { query, withTransaction } from '../database/pool';
import type { CreateTaskInput, TaskRow, TaskWithMeta, UpdateTaskInput } from '../types/task';

/**
 * Data access for tasks and their project associations.
 * List queries aggregate deferral counts and project rows in one round trip
 * (no N+1). All queries are scoped to the owning user.
 */

// Shared SELECT that enriches tasks with deferral_count and a projects JSON array.
const TASK_WITH_META_SELECT = `
  SELECT
    t.*,
    COALESCE(d.cnt, 0)::int AS deferral_count,
    COALESCE(
      json_agg(
        json_build_object('id', p.id, 'name', p.name, 'priorityOrder', p.priority_order, 'color', p.color)
        ORDER BY p.priority_order
      ) FILTER (WHERE p.id IS NOT NULL),
      '[]'
    ) AS projects
  FROM tasks t
  LEFT JOIN (SELECT task_id, COUNT(*) AS cnt FROM deferrals GROUP BY task_id) d ON d.task_id = t.id
  LEFT JOIN task_projects tp ON tp.task_id = t.id
  LEFT JOIN projects p ON p.id = tp.project_id
`;

export async function create(userId: string, data: CreateTaskInput): Promise<TaskRow> {
  return withTransaction(async (client) => {
    const isRepeatable = data.isRepeatable ?? false;
    // A repeatable task starts a new series identified by a fresh, standalone UUID
    // (independent of any task id, so it survives occurrence deletion).
    const res = await client.query<TaskRow>(
      `INSERT INTO tasks (user_id, subject, priority, due_date, due_time, is_repeatable, repeat_pattern, repeat_series_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 THEN gen_random_uuid() ELSE NULL END)
       RETURNING *`,
      [
        userId,
        data.subject,
        data.priority,
        data.dueDate ?? null,
        data.dueTime ?? null,
        isRepeatable,
        data.repeatPattern ? JSON.stringify(data.repeatPattern) : null,
      ],
    );
    const task = res.rows[0];
    if (data.projectIds && data.projectIds.length > 0) {
      await insertAssociations(client, task.id, data.projectIds);
    }
    return task;
  });
}

export async function findActiveByUser(
  userId: string,
  opts: { projectId?: string; includeCompleted?: boolean } = {},
): Promise<TaskWithMeta[]> {
  const params: unknown[] = [userId];
  let where = 't.user_id = $1 AND t.archived_at IS NULL';
  if (!opts.includeCompleted) {
    where += ' AND t.completed_at IS NULL';
  }
  if (opts.projectId) {
    params.push(opts.projectId);
    // Restrict to tasks that belong to the given project.
    where += ` AND t.id IN (SELECT task_id FROM task_projects WHERE project_id = $${params.length})`;
  }
  const res = await query<TaskWithMeta>(
    `${TASK_WITH_META_SELECT} WHERE ${where} GROUP BY t.id, d.cnt`,
    params,
  );
  return res.rows;
}

export async function findByIdForUser(userId: string, id: string): Promise<TaskWithMeta | null> {
  const res = await query<TaskWithMeta>(
    `${TASK_WITH_META_SELECT} WHERE t.id = $1 AND t.user_id = $2 AND t.archived_at IS NULL GROUP BY t.id, d.cnt`,
    [id, userId],
  );
  return res.rows[0] ?? null;
}

export async function update(
  userId: string,
  id: string,
  patch: UpdateTaskInput,
): Promise<TaskRow | null> {
  return withTransaction(async (client) => {
    // Build a dynamic SET clause from provided fields only.
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.subject !== undefined) push('subject', patch.subject);
    if (patch.priority !== undefined) push('priority', patch.priority);
    if (patch.dueDate !== undefined) push('due_date', patch.dueDate);
    if (patch.dueTime !== undefined) push('due_time', patch.dueTime);
    if (patch.isRepeatable !== undefined) push('is_repeatable', patch.isRepeatable);
    if (patch.repeatPattern !== undefined)
      push('repeat_pattern', patch.repeatPattern ? JSON.stringify(patch.repeatPattern) : null);

    let task: TaskRow | undefined;
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(id, userId);
      const res = await client.query<TaskRow>(
        `UPDATE tasks SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND user_id = $${params.length} AND archived_at IS NULL
         RETURNING *`,
        params,
      );
      task = res.rows[0];
    } else {
      const res = await client.query<TaskRow>(
        'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 AND archived_at IS NULL',
        [id, userId],
      );
      task = res.rows[0];
    }

    if (!task) return null;

    if (patch.projectIds !== undefined) {
      await client.query('DELETE FROM task_projects WHERE task_id = $1', [id]);
      if (patch.projectIds.length > 0) {
        await insertAssociations(client, id, patch.projectIds);
      }
    }
    return task;
  });
}

export async function setCompleted(
  userId: string,
  id: string,
  weightAtCompletion: number,
): Promise<TaskRow | null> {
  const res = await query<TaskRow>(
    `UPDATE tasks SET completed_at = NOW(), updated_at = NOW(), weight_at_completion = $3
     WHERE id = $1 AND user_id = $2 AND archived_at IS NULL AND completed_at IS NULL
     RETURNING *`,
    [id, userId, weightAtCompletion],
  );
  return res.rows[0] ?? null;
}

export async function applyDefer(
  userId: string,
  id: string,
  patch: { dueDate?: string | null; dueTime?: string | null; priority?: string },
): Promise<TaskRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown): void => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.dueDate !== undefined) push('due_date', patch.dueDate);
  if (patch.dueTime !== undefined) push('due_time', patch.dueTime);
  if (patch.priority !== undefined) push('priority', patch.priority);
  sets.push('updated_at = NOW()');
  params.push(id, userId);
  const res = await query<TaskRow>(
    `UPDATE tasks SET ${sets.join(', ')}
     WHERE id = $${params.length - 1} AND user_id = $${params.length}
       AND archived_at IS NULL AND completed_at IS NULL
     RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}

export async function archive(userId: string, id: string): Promise<boolean> {
  const res = await query(
    `UPDATE tasks SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [id, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

// --- helpers ----------------------------------------------------------------

import type { PoolClient } from 'pg';

async function insertAssociations(
  client: PoolClient,
  taskId: string,
  projectIds: string[],
): Promise<void> {
  const unique = [...new Set(projectIds)];
  const values = unique.map((_, i) => `($1, $${i + 2})`).join(', ');
  await client.query(
    `INSERT INTO task_projects (task_id, project_id) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [taskId, ...unique],
  );
}
