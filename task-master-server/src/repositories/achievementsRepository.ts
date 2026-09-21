import { query } from '../database/pool';
import type { AchievementRow } from '../services/achievements/achievementsService';

/**
 * Data access for the `achievements` table.
 *
 * Idempotency slot: the unique index `idx_achievements_unique` keys on
 * `(user_id, type, (COALESCE(data->>'task_id', '')))` — an expression index on
 * the `data.task_id` JSONB key, not a physical column. Every per-slot
 * achievement therefore stores its slot value under `data.task_id` (even when
 * the value is semantically a series id or a local date), while global-once
 * achievements omit it so `COALESCE(...,'')` collapses them to a single slot
 * per (user_id, type). All queries are parameterized — never interpolate user
 * data into the SQL text.
 */

/**
 * Idempotently unlock one achievement.
 *
 * `slot` is written to `data.task_id` (the key the unique index reads); a null
 * slot omits `task_id` so `COALESCE(data->>'task_id', '')` collapses to '' and
 * yields one row per (user, type). `dataExtra` may carry a readable semantic
 * alias (e.g. `series_id` / `local_date`) so the persisted payload is
 * self-describing.
 *
 * Returns true iff a NEW row was created — i.e. this is a newly-unlocked
 * achievement. A conflict returns zero rows ⇒ false.
 */
export async function unlock(
  userId: string,
  type: string,
  slot: string | null,
  dataExtra?: Record<string, unknown>,
): Promise<boolean> {
  const data: Record<string, unknown> = {};
  if (slot != null) data.task_id = slot;
  if (dataExtra) Object.assign(data, dataExtra);

  // The conflict target repeats the EXACT index expression
  // `(user_id, type, (COALESCE(data->>'task_id', '')))` — a plain column list
  // cannot address an expression index (same pattern as streakRepository.upsert).
  const res = await query<{ id: string }>(
    `INSERT INTO achievements (user_id, type, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, type, (COALESCE(data->>'task_id', '')))
     DO NOTHING
     RETURNING id`,
    [userId, type, JSON.stringify(data)],
  );

  return (res.rowCount ?? 0) === 1;
}

/**
 * Count the user's tasks completed on the given user-local day (tz-aware).
 *
 * `completed_at` is a timestamptz (an instant); `AT TIME ZONE $2` yields the
 * wall-clock timestamp in the user's IANA zone, and `::date` extracts the local
 * calendar day. Comparing that to `$3::date` selects exactly the completions
 * that fall on the user's local day, entirely in the database.
 */
export async function countCompletionsOnLocalDay(
  userId: string,
  tz: string,
  localDay: string,
): Promise<number> {
  const res = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM tasks
     WHERE user_id = $1
       AND completed_at IS NOT NULL
       AND (completed_at AT TIME ZONE $2)::date = $3::date`,
    [userId, tz, localDay],
  );
  return Number(res.rows[0].count);
}

/**
 * All achievements for a user, newest first, scoped to user_id. `data` is jsonb
 * (pg returns it already parsed as an object) and `unlocked_at` is a Date — no
 * normalization needed.
 */
export async function listForUser(userId: string): Promise<AchievementRow[]> {
  const res = await query<AchievementRow>(
    `SELECT id, type, unlocked_at, data
     FROM achievements
     WHERE user_id = $1
     ORDER BY unlocked_at DESC`,
    [userId],
  );
  return res.rows;
}
