import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Make the per-user project ordering uniqueness DEFERRABLE so reorders can
 * reassign priority_order for many rows within a single transaction without
 * hitting transient collisions (uniqueness is checked at COMMIT).
 *
 * The original constraint was a plain unique INDEX (uq_projects_user_priority),
 * which cannot be deferred; we replace it with a deferrable unique CONSTRAINT.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('projects', ['user_id', 'priority_order'], { name: 'uq_projects_user_priority' });
  pgm.addConstraint('projects', 'uq_projects_user_priority', {
    unique: ['user_id', 'priority_order'],
    deferrable: true,
    deferred: true,
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('projects', 'uq_projects_user_priority');
  pgm.createIndex('projects', ['user_id', 'priority_order'], {
    unique: true,
    name: 'uq_projects_user_priority',
  });
}
