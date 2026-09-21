import fc from 'fast-check';
import { pool } from '../database/pool';
import { unlock } from './achievementsRepository';

/**
 * DB-backed property tests for achievementsRepository.unlock against the
 * integration Postgres (migrated by Jest globalSetup; tables truncated between
 * `it` blocks by setupAfterEnv).
 *
 * Covers design.md "Correctness Properties":
 *   - Property 1 (Unlock idempotency)
 *   - Property 3 (Per-slot independence)
 *
 * Both run a minimum of 100 iterations. Truncation only happens BETWEEN `it`
 * blocks, not between fast-check runs, so each run generates a UNIQUE `type`
 * (a per-run uuid suffix) and counts rows filtered by that exact type — every
 * run's rows are therefore independent of every other run's.
 */

let userId: string;

// The global setupAfterEnv truncates `users` (RESTART IDENTITY CASCADE) before
// EVERY test, which would wipe a user inserted in beforeAll. Insert the
// prerequisite user in beforeEach — after truncation — so it exists for the
// duration of each `it`. achievements.user_id is an FK to users(id).
beforeEach(async () => {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, NULL)
     RETURNING id`,
    ['achv-prop@example.com'],
  );
  userId = res.rows[0].id;
});

/** Count achievement rows for this user with an exact type. */
async function countByType(type: string): Promise<number> {
  const res = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM achievements WHERE user_id = $1 AND type = $2`,
    [userId, type],
  );
  return Number(res.rows[0].count);
}

describe('unlock — Property 1 (unlock idempotency)', () => {
  // Feature: achievements, Property 1: For any user, achievement type, and slot
  // value (including a null slot), calling unlock two or more times with the same
  // (user_id, type, slot) creates exactly one row and returns true on the first
  // call and false on every subsequent call.
  // Validates: Requirements 1.1, 1.2, 7.1, 7.4
  it('two unlocks with same (user,type,slot): first true, second false, one row (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // per-run unique suffix => isolates each run's rows
        fc.option(fc.uuid(), { nil: null }), // slot, including null
        async (suffix, slot) => {
          const type = `prop1_${suffix}`;

          const first = await unlock(userId, type, slot);
          const second = await unlock(userId, type, slot);

          expect(first).toBe(true);
          expect(second).toBe(false);
          expect(await countByType(type)).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('unlock — Property 3 (per-slot independence)', () => {
  // Feature: achievements, Property 3: For any user and achievement type, and any
  // two distinct slot values s1 != s2, unlocking (user, type, s1) and
  // (user, type, s2) each create a separate row (both return true), so per-slot
  // achievement types unlock independently for each distinct series id, task id,
  // or user-local day.
  // Validates: Requirements 3.4, 4.3, 5.2, 6.3
  it('two distinct slots for same (user,type): both true, two rows (fast-check, >= 100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // per-run unique type suffix
        fc.uuid(),
        fc.uuid(),
        async (suffix, a, b) => {
          // Guarantee two DISTINCT non-null slot values.
          fc.pre(a !== b);
          const type = `prop3_${suffix}`;

          const r1 = await unlock(userId, type, a);
          const r2 = await unlock(userId, type, b);

          expect(r1).toBe(true);
          expect(r2).toBe(true);
          expect(await countByType(type)).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
