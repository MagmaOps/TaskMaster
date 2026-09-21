import { query } from '../database/pool';
import type { StreakState } from '../services/streaks/streakMath';

/**
 * Data access for the `streaks` table.
 *
 * Streak key: a row is identified by (user_id, series_id). `series_id IS NULL`
 * is the daily streak; a non-NULL `series_id` is a per-series streak keyed on a
 * task's standalone `repeat_series_id`. The unique index is an expression index
 * on `(user_id, COALESCE(series_id, zero-uuid))`, so NULL series ids collapse to
 * the shared zero-uuid slot for both lookup and upsert.
 */

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * pg returns DATE columns as JS `Date` objects (not strings). The node-postgres
 * DATE parser constructs the Date at the server's LOCAL midnight for the stored
 * calendar day (e.g. DATE '2026-09-20' -> 2026-09-20T00:00:00 in the server
 * zone). The local getters therefore faithfully recover the stored y/m/d in any
 * server zone; using UTC getters would shift the date back a day whenever the
 * server runs ahead of UTC (e.g. BST/CEST). Strings are sliced to the date part;
 * null passes through.
 */
function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

interface StreakRow {
  current_streak: number;
  longest_streak: number;
  last_completed_date: unknown;
}

/**
 * Fetch the streak state for a given key, or null if none exists yet.
 * A null `seriesId` targets the daily row (matched via the zero-uuid slot).
 */
export async function getByKey(
  userId: string,
  seriesId: string | null,
): Promise<StreakState | null> {
  const res = await query<StreakRow>(
    `SELECT current_streak, longest_streak, last_completed_date
     FROM streaks
     WHERE user_id = $1
       AND COALESCE(series_id, $3::uuid) = COALESCE($2::uuid, $3::uuid)`,
    [userId, seriesId, ZERO_UUID],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    current: row.current_streak,
    longest: row.longest_streak,
    lastCompletedDate: normalizeDate(row.last_completed_date),
  };
}

/**
 * Insert or update the streak state for a key. Uses ON CONFLICT on the exact
 * expression index `(user_id, COALESCE(series_id, zero-uuid))` — a plain column
 * conflict target cannot address an expression index, so the index expression is
 * repeated verbatim.
 */
export async function upsert(
  userId: string,
  seriesId: string | null,
  state: StreakState,
): Promise<void> {
  await query(
    `INSERT INTO streaks
       (user_id, series_id, current_streak, longest_streak, last_completed_date, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, COALESCE(series_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET
       current_streak = EXCLUDED.current_streak,
       longest_streak = EXCLUDED.longest_streak,
       last_completed_date = EXCLUDED.last_completed_date,
       updated_at = NOW()`,
    [userId, seriesId, state.current, state.longest, state.lastCompletedDate],
  );
}

interface SeriesStreakRow extends StreakRow {
  series_id: string;
  label: string | null;
}

export interface StreakSeriesEntry {
  seriesId: string;
  label: string;
  current: number;
  longest: number;
  lastCompletedDate: string | null;
}

export interface UserStreaks {
  daily: StreakState | null;
  series: StreakSeriesEntry[];
}

/**
 * List all streaks for a user: the daily streak (series_id IS NULL) plus every
 * per-series streak. Each series row is joined to a representative subject label
 * — the subject of the most recent task (max created_at) sharing that
 * repeat_series_id — via a LEFT JOIN LATERAL. Series with no surviving task fall
 * back to an empty label. Series are ordered by most recent activity.
 */
export async function listForUser(userId: string): Promise<UserStreaks> {
  const dailyRes = await query<StreakRow>(
    `SELECT current_streak, longest_streak, last_completed_date
     FROM streaks
     WHERE user_id = $1 AND series_id IS NULL`,
    [userId],
  );
  const dailyRow = dailyRes.rows[0];
  const daily: StreakState | null = dailyRow
    ? {
        current: dailyRow.current_streak,
        longest: dailyRow.longest_streak,
        lastCompletedDate: normalizeDate(dailyRow.last_completed_date),
      }
    : null;

  const seriesRes = await query<SeriesStreakRow>(
    `SELECT s.series_id, s.current_streak, s.longest_streak, s.last_completed_date, t.subject AS label
     FROM streaks s
     LEFT JOIN LATERAL (
       SELECT subject FROM tasks
       WHERE user_id = s.user_id AND repeat_series_id = s.series_id
       ORDER BY created_at DESC LIMIT 1
     ) t ON true
     WHERE s.user_id = $1 AND s.series_id IS NOT NULL
     ORDER BY s.last_completed_date DESC NULLS LAST`,
    [userId],
  );

  const series: StreakSeriesEntry[] = seriesRes.rows.map((row) => ({
    seriesId: row.series_id,
    label: row.label ?? '',
    current: row.current_streak,
    longest: row.longest_streak,
    lastCompletedDate: normalizeDate(row.last_completed_date),
  }));

  return { daily, series };
}
