import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Admin flag on users.
 *
 * Adds `users.is_admin boolean NOT NULL DEFAULT false`. Admin is a
 * privileged, server-trusted capability granted out-of-band (a DB update by
 * the operator) — there is deliberately no self-serve path to becoming admin.
 *
 * Its first use is a developer affordance: an admin may change their own
 * `tier` (free/premium) via PATCH /api/auth/me to exercise premium features.
 * The tier change is gated on this flag server-side; the client cannot grant
 * itself premium.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('users', {
    is_admin: { type: 'boolean', notNull: true, default: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('users', 'is_admin');
}
