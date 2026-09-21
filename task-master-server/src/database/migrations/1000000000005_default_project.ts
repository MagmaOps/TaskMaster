import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Per-user **Unassigned** project (Requirements 8-12).
 *
 * Introduces a real `projects` row, flagged `is_default`, that transparently
 * owns any task with no Real_Project. It sits at `priority_order = 0` — outside
 * the user-reorderable 1-20 range — so it never collides with the existing
 * `uq_projects_user_priority` unique constraint and is excluded from reorders
 * and the 20-max limit.
 *
 * Up:
 *  - Add `projects.is_default boolean NOT NULL DEFAULT false`.
 *  - Relax the priority_order CHECK from `>= 1 AND <= 20` to `>= 0 AND <= 20`
 *    so the Unassigned row can sit at order 0. The CHECK was created inline by
 *    `createTable` in migration 1 and named `projects_priority_order_check` by
 *    node-pg-migrate (verified against the dev DB). Migration 2 only altered the
 *    UNIQUE constraint, not this CHECK.
 *  - Add a partial unique index `uq_projects_one_default ON projects (user_id)
 *    WHERE is_default` — at most one Unassigned per user.
 *  - Backfill one Unassigned project per existing user (Req 8.3).
 *  - Backfill memberships: link every task that has no `task_projects` row to
 *    its owner's Unassigned project.
 *
 * Down (reversible): unlink default associations, delete the default projects,
 * drop the partial unique index, restore the CHECK to `>= 1 AND <= 20`, then
 * drop the `is_default` column.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // 1. Flag column for the Unassigned project.
  pgm.addColumn('projects', {
    is_default: { type: 'boolean', notNull: true, default: false },
  });

  // 2. Relax the priority_order CHECK to allow order 0 (Unassigned).
  pgm.sql('ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_order_check;');
  pgm.sql(
    'ALTER TABLE projects ADD CONSTRAINT projects_priority_order_check CHECK (priority_order >= 0 AND priority_order <= 20);',
  );

  // 3. At most one Unassigned project per user.
  pgm.sql('CREATE UNIQUE INDEX uq_projects_one_default ON projects (user_id) WHERE is_default;');

  // 4. Backfill one Unassigned project per existing user.
  pgm.sql(
    "INSERT INTO projects (user_id, name, priority_order, is_default) SELECT id, 'Unassigned', 0, true FROM users;",
  );

  // 5. Backfill memberships: link every orphan task to its owner's Unassigned project.
  pgm.sql(
    'INSERT INTO task_projects (task_id, project_id) ' +
      'SELECT t.id, dp.id FROM tasks t ' +
      'JOIN projects dp ON dp.user_id = t.user_id AND dp.is_default ' +
      'WHERE NOT EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id);',
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // 1. Remove memberships referencing default projects.
  pgm.sql('DELETE FROM task_projects WHERE project_id IN (SELECT id FROM projects WHERE is_default);');

  // 2. Delete the default projects.
  pgm.sql('DELETE FROM projects WHERE is_default;');

  // 3. Drop the partial unique index.
  pgm.sql('DROP INDEX IF EXISTS uq_projects_one_default;');

  // 4. Restore the CHECK to the original 1-20 range.
  pgm.sql('ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_order_check;');
  pgm.sql(
    'ALTER TABLE projects ADD CONSTRAINT projects_priority_order_check CHECK (priority_order >= 1 AND priority_order <= 20);',
  );

  // 5. Drop the flag column.
  pgm.dropColumn('projects', 'is_default');
}
