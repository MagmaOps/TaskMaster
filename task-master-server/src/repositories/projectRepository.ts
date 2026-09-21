import { query, withTransaction } from '../database/pool';
import { ApiError } from '../utils/errors';
import type {
  CreateProjectInput,
  ProjectRow,
  ProjectWithCount,
  UpdateProjectInput,
} from '../types/project';

/**
 * Data access for projects and their ordering. This is the single source of
 * truth for project reads/writes and supersedes the former projectReadRepository.
 *
 * Ordering note: the unique (user_id, priority_order) constraint makes reorders
 * fragile, so all order-mutating operations run in a transaction and avoid
 * transient collisions (see reorder's two-phase approach and remove's gap-close).
 */

/**
 * Idempotently ensure the user's **Unassigned** project exists and return it.
 *
 * The `is_default` uniqueness is enforced by a *partial* unique index
 * (`uq_projects_one_default ... WHERE is_default`), so the upsert must repeat
 * that index predicate in its `ON CONFLICT` target. On a conflict the INSERT
 * returns no row, so we SELECT the pre-existing default. (Req 8.1, 8.4)
 */
export async function ensureDefault(userId: string): Promise<ProjectRow> {
  const inserted = await query<ProjectRow>(
    `INSERT INTO projects (user_id, name, priority_order, is_default)
     VALUES ($1, 'Unassigned', 0, true)
     ON CONFLICT (user_id) WHERE is_default DO NOTHING
     RETURNING *`,
    [userId],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await query<ProjectRow>(
    'SELECT * FROM projects WHERE user_id = $1 AND is_default',
    [userId],
  );
  return existing.rows[0];
}

/** The user's Unassigned project, or null if it does not exist yet. */
export async function getDefault(userId: string): Promise<ProjectRow | null> {
  const res = await query<ProjectRow>('SELECT * FROM projects WHERE user_id = $1 AND is_default', [
    userId,
  ]);
  return res.rows[0] ?? null;
}

/**
 * For weighting: lightweight id + priority order + default flag list. The
 * weight path uses `is_default` to exclude the Unassigned project. Ordered by
 * priority_order so the Unassigned row (order 0) sorts first.
 */
export async function listForUser(
  userId: string,
): Promise<{ id: string; priority_order: number; is_default: boolean }[]> {
  const res = await query<{ id: string; priority_order: number; is_default: boolean }>(
    'SELECT id, priority_order, is_default FROM projects WHERE user_id = $1 ORDER BY priority_order ASC',
    [userId],
  );
  return res.rows;
}

/** Projects with a count of the user's ACTIVE tasks associated with each. */
export async function listForUserWithCounts(userId: string): Promise<ProjectWithCount[]> {
  const res = await query<ProjectWithCount>(
    `SELECT p.*, COALESCE(c.cnt, 0)::int AS task_count
       FROM projects p
       LEFT JOIN (
         SELECT tp.project_id, COUNT(*) AS cnt
           FROM task_projects tp
           JOIN tasks t ON t.id = tp.task_id
          WHERE t.completed_at IS NULL AND t.archived_at IS NULL
          GROUP BY tp.project_id
       ) c ON c.project_id = p.id
      WHERE p.user_id = $1
      ORDER BY p.priority_order ASC`,
    [userId],
  );
  return res.rows;
}

/** Count of the user's Real_Projects (excludes Unassigned) for the 20-max. */
export async function countForUser(userId: string): Promise<number> {
  const res = await query<{ cnt: string }>(
    'SELECT COUNT(*) AS cnt FROM projects WHERE user_id = $1 AND is_default = false',
    [userId],
  );
  return Number(res.rows[0].cnt);
}

export async function findByIdForUser(userId: string, id: string): Promise<ProjectRow | null> {
  const res = await query<ProjectRow>('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return res.rows[0] ?? null;
}

/** Case-insensitive name lookup for uniqueness checks. */
export async function findByNameForUser(userId: string, name: string): Promise<ProjectRow | null> {
  const res = await query<ProjectRow>(
    'SELECT * FROM projects WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
    [userId, name],
  );
  return res.rows[0] ?? null;
}

export async function create(userId: string, data: CreateProjectInput): Promise<ProjectRow> {
  return withTransaction(async (client) => {
    const orderRes = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(priority_order), 0) + 1 AS next FROM projects WHERE user_id = $1',
      [userId],
    );
    const nextOrder = orderRes.rows[0].next;
    const res = await client.query<ProjectRow>(
      `INSERT INTO projects (user_id, name, priority_order, color)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, data.name, nextOrder, data.color ?? null],
    );
    return res.rows[0];
  });
}

export async function update(
  userId: string,
  id: string,
  patch: UpdateProjectInput,
): Promise<ProjectRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown): void => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) push('name', patch.name);
  if (patch.color !== undefined) push('color', patch.color);
  if (sets.length === 0) {
    return findByIdForUser(userId, id);
  }
  sets.push('updated_at = NOW()');
  params.push(id, userId);
  const res = await query<ProjectRow>(
    `UPDATE projects SET ${sets.join(', ')}
     WHERE id = $${params.length - 1} AND user_id = $${params.length}
     RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}

/**
 * Re-rank all of the user's projects to match `orderedIds` (index+1 => priority_order).
 * The unique (user_id, priority_order) constraint is DEFERRABLE INITIALLY DEFERRED
 * (see migration 1000000000002), so per-row updates within this transaction may
 * transiently collide; uniqueness is validated at COMMIT.
 */
export async function reorder(userId: string, orderedIds: string[]): Promise<ProjectRow[]> {
  return withTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE projects SET priority_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [i + 1, orderedIds[i], userId],
      );
    }
    const res = await client.query<ProjectRow>(
      'SELECT * FROM projects WHERE user_id = $1 ORDER BY priority_order ASC',
      [userId],
    );
    return res.rows;
  });
}

/**
 * Delete a project (its task_projects associations cascade via FK; tasks are
 * NOT deleted) and close the gap so remaining orders stay contiguous.
 * Returns false if the project doesn't exist / isn't owned by the user.
 */
export async function remove(userId: string, id: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const del = await client.query<{ priority_order: number }>(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING priority_order',
      [id, userId],
    );
    if (del.rowCount === 0) return false;
    const removedOrder = del.rows[0].priority_order;
    await client.query(
      `UPDATE projects SET priority_order = priority_order - 1
        WHERE user_id = $1 AND priority_order > $2`,
      [userId, removedOrder],
    );
    return true;
  });
}

/**
 * Throws 400 if any of the given project ids is not owned by the user, or is a
 * default (Unassigned) project. The Unassigned membership is system-managed, so
 * clients must not supply its id in task create/update `projectIds` (Req 9.5).
 */
export async function assertOwned(userId: string, projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  const res = await query<{ id: string; is_default: boolean }>(
    'SELECT id, is_default FROM projects WHERE user_id = $1 AND id = ANY($2::uuid[])',
    [userId, projectIds],
  );
  const hasDefault = res.rows.some((r) => r.is_default);
  if (res.rows.length !== new Set(projectIds).size || hasDefault) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'One or more project ids are invalid');
  }
}
