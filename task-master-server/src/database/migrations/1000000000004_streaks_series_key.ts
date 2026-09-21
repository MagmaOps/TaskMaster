import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Re-key the `streaks` table on a standalone series id instead of a task id.
 *
 * Per-series streaks must key on `repeat_series_id`, which is a standalone UUID
 * (not a task id) that survives deletion of any individual occurrence row. The
 * original `task_id` column is an FK to tasks(id) ON DELETE CASCADE, so it can
 * neither hold a standalone series id nor safely outlive its occurrences.
 *
 * This migration adds `series_id` (nullable, NO foreign key) as the streak key,
 * drops the now-dead `task_id` column (and its FK), and moves the unique index
 * to `(user_id, COALESCE(series_id, zero-uuid))`. A NULL series_id => the user's
 * overall daily streak; a non-NULL series_id => a per-series streak.
 *
 * Greenfield: there is no streak data to preserve, so `task_id` is dropped
 * outright rather than backfilled. The down migration restores the original
 * `task_id` column, FK, and task-keyed unique index.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // Standalone series id — no FK; series ids are not task ids.
  pgm.addColumn('streaks', { series_id: { type: 'uuid', notNull: false } });

  // Drop the old task-keyed unique index before removing the column it references.
  pgm.dropIndex('streaks', [], { name: 'idx_streaks_unique' });

  // task_id is now unused for streaks (greenfield, no data to preserve).
  pgm.dropColumn('streaks', 'task_id');

  // Unique per (user, series) treating NULL series_id as the single daily streak.
  pgm.sql(
    `CREATE UNIQUE INDEX idx_streaks_unique
       ON streaks (user_id, COALESCE(series_id, '00000000-0000-0000-0000-000000000000'::uuid));`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('streaks', [], { name: 'idx_streaks_unique' });

  pgm.dropColumn('streaks', 'series_id');

  // Restore the original per-repeatable-task key column and its FK.
  pgm.addColumn('streaks', {
    task_id: { type: 'uuid', notNull: false, references: 'tasks', onDelete: 'CASCADE' },
  });

  pgm.sql(
    `CREATE UNIQUE INDEX idx_streaks_unique
       ON streaks (user_id, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid));`,
  );
}
