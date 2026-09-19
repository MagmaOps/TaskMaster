import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Core domain tables: tasks, projects, task_projects (M:N), deferrals,
 * achievements, and streaks. Includes performance indexes for weight sorting.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // --- projects ---------------------------------------------------------------
  pgm.createTable('projects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    name: { type: 'varchar(255)', notNull: true },
    priority_order: {
      type: 'integer',
      notNull: true,
      check: 'priority_order >= 1 AND priority_order <= 20',
    },
    color: { type: 'varchar(7)', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('projects', ['user_id', 'name'], { unique: true, name: 'uq_projects_user_name' });
  pgm.createIndex('projects', ['user_id', 'priority_order'], {
    unique: true,
    name: 'uq_projects_user_priority',
  });

  // --- tasks ------------------------------------------------------------------
  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    subject: { type: 'varchar(500)', notNull: true },
    priority: {
      type: 'varchar(10)',
      notNull: true,
      check: "priority IN ('high','medium','low')",
    },
    due_date: { type: 'date', notNull: false },
    due_time: { type: 'time', notNull: false },
    is_repeatable: { type: 'boolean', notNull: true, default: false },
    repeat_pattern: { type: 'jsonb', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    completed_at: { type: 'timestamptz', notNull: false },
    archived_at: { type: 'timestamptz', notNull: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('tasks', 'user_id', { name: 'idx_tasks_user_id' });
  pgm.createIndex('tasks', 'due_date', { name: 'idx_tasks_due_date', where: 'due_date IS NOT NULL' });
  // Partial index for the hot path: a user's active (not completed, not archived) tasks.
  pgm.createIndex('tasks', ['user_id', 'created_at'], {
    name: 'idx_tasks_active',
    where: 'completed_at IS NULL AND archived_at IS NULL',
  });

  // --- task_projects (M:N) ----------------------------------------------------
  pgm.createTable('task_projects', {
    task_id: { type: 'uuid', notNull: true, references: 'tasks', onDelete: 'CASCADE' },
    project_id: { type: 'uuid', notNull: true, references: 'projects', onDelete: 'CASCADE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('task_projects', 'pk_task_projects', {
    primaryKey: ['task_id', 'project_id'],
  });
  pgm.createIndex('task_projects', 'task_id', { name: 'idx_task_projects_task' });
  pgm.createIndex('task_projects', 'project_id', { name: 'idx_task_projects_project' });

  // --- deferrals --------------------------------------------------------------
  pgm.createTable('deferrals', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    task_id: { type: 'uuid', notNull: true, references: 'tasks', onDelete: 'CASCADE' },
    deferred_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    option_chosen: {
      type: 'varchar(20)',
      notNull: true,
      check: "option_chosen IN ('later_today','tomorrow','sometime_later')",
    },
  });
  pgm.createIndex('deferrals', 'task_id', { name: 'idx_deferrals_task' });

  // --- achievements -----------------------------------------------------------
  pgm.createTable('achievements', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    type: { type: 'varchar(100)', notNull: true },
    unlocked_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    data: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.createIndex('achievements', 'user_id', { name: 'idx_achievements_user' });
  // Prevent duplicate achievements of the same type per user (per optional task_id in data).
  pgm.sql(
    `CREATE UNIQUE INDEX idx_achievements_unique
       ON achievements (user_id, type, (COALESCE(data->>'task_id', '')));`,
  );

  // --- streaks ----------------------------------------------------------------
  pgm.createTable('streaks', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    // NULL task_id => the user's overall daily streak; otherwise per-repeatable-task.
    task_id: { type: 'uuid', notNull: false, references: 'tasks', onDelete: 'CASCADE' },
    current_streak: { type: 'integer', notNull: true, default: 0 },
    longest_streak: { type: 'integer', notNull: true, default: 0 },
    last_completed_date: { type: 'date', notNull: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('streaks', 'user_id', { name: 'idx_streaks_user' });
  // Unique per (user, task) treating NULL task_id as the single daily streak.
  pgm.sql(
    `CREATE UNIQUE INDEX idx_streaks_unique
       ON streaks (user_id, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid));`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('streaks');
  pgm.dropTable('achievements');
  pgm.dropTable('deferrals');
  pgm.dropTable('task_projects');
  pgm.dropTable('tasks');
  pgm.dropTable('projects');
}
