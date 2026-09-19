import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Shared columns for completion-driven features:
 * - weight_at_completion: the task's computed weight at completion time,
 *   persisted so economy/analytics/achievements can use it after the fact.
 * - repeat_series_id: a standalone UUID identifying a recurring series,
 *   independent of any occurrence row (survives occurrence deletion). Used by
 *   streaks (per-series key) and task-recurrence (copied onto new occurrences).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('tasks', {
    weight_at_completion: { type: 'integer', notNull: false },
    repeat_series_id: { type: 'uuid', notNull: false },
  });
  pgm.createIndex('tasks', 'repeat_series_id', {
    name: 'idx_tasks_repeat_series',
    where: 'repeat_series_id IS NOT NULL',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('tasks', 'repeat_series_id', { name: 'idx_tasks_repeat_series' });
  pgm.dropColumn('tasks', ['weight_at_completion', 'repeat_series_id']);
}
