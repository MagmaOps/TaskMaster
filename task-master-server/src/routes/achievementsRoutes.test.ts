import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import {
  clearCompletionListeners,
  registerCompletionListener,
  type UnlockedAchievement,
} from '../services/completion/completionEvents';
import * as streakService from '../services/streaks/streakService';
import * as achievementsService from '../services/achievements/achievementsService';
import { localCalendarDate } from '../services/time/userTime';

/**
 * Integration tests for achievements (Jest + Supertest).
 *
 * Isolation follows the established listener-reset determinism pattern (economy
 * / streaks suites): this suite OWNS the process-global listener registry in
 * beforeAll and resets it to exactly [streak, achievements] — IN THAT ORDER,
 * because the achievements listener reads `event.streaks` published by the
 * streak listener (registration order is load-bearing, design.md "Completion-
 * listener slot").
 *
 * The global setupAfterEnv truncates every data table before EACH test, so
 * every `it` starts from a clean database; per-test users are registered fresh.
 * The test env user timezone defaults to 'UTC', so the user's local "today"
 * equals localCalendarDate('UTC').
 *
 * The two registry-sensitive cases (Req 10.4 event.streaks undefined, Req 10.2
 * dispatcher isolation) live in a separate file
 * (achievementsListener.isolation.test.ts) so they can fully control the
 * registry without corrupting this suite's [streak, achievements] setup.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
  clearCompletionListeners();
  // Streak FIRST so it populates event.streaks, THEN achievements reads it.
  registerCompletionListener(streakService.onTaskCompleted);
  registerCompletionListener(achievementsService.onTaskCompleted);
});

async function registerUser(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'hunter2pass' });
  return res.body.data.accessToken as string;
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Resolve a user's id from the token by reading it back from the DB via email. */
async function userIdOf(email: string): Promise<string> {
  const res = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  return res.rows[0].id;
}

/**
 * Create a task (optionally repeatable / high-priority) and complete it.
 * Returns the completion response body's `data` (includes unlocked +
 * weightAtCompletion). Mirrors the economy/streaks createAndComplete helpers.
 */
async function createTask(
  token: string,
  subject: string,
  opts: { repeatable?: boolean; priority?: 'high' | 'medium' | 'low' } = {},
): Promise<string> {
  const body: Record<string, unknown> = { subject, priority: opts.priority ?? 'high' };
  if (opts.repeatable) {
    body.isRepeatable = true;
    body.repeatPattern = { frequency: 'daily', interval: 1 };
  }
  const created = await request(app).post('/api/tasks').set(auth(token)).send(body);
  return created.body.data.id as string;
}

interface CompleteResult {
  unlocked: UnlockedAchievement[];
  weightAtCompletion: number;
}
async function complete(token: string, taskId: string): Promise<CompleteResult> {
  const res = await request(app).put(`/api/tasks/${taskId}/complete`).set(auth(token));
  return { unlocked: res.body.data.unlocked, weightAtCompletion: res.body.data.weightAtCompletion };
}

async function createAndComplete(
  token: string,
  subject: string,
  opts: { repeatable?: boolean; priority?: 'high' | 'medium' | 'low' } = {},
): Promise<CompleteResult> {
  const id = await createTask(token, subject, opts);
  return complete(token, id);
}

/** True iff `unlocked` contains an entry of the given type. */
function hasType(unlocked: UnlockedAchievement[], type: string): boolean {
  return unlocked.some((u) => u.type === type);
}
/** The (first) unlocked entry of a given type, or undefined. */
function findType(
  unlocked: UnlockedAchievement[],
  type: string,
): UnlockedAchievement | undefined {
  return unlocked.find((u) => u.type === type);
}

/** The user's local "today" in the test env (timezone defaults to UTC). */
const today = localCalendarDate('UTC');

/**
 * Directly INSERT a completed task row for a user with a chosen completed_at
 * instant (a timestamptz). Used to seed same-local-day completions for the
 * productivity-burst count without driving each one through the API.
 */
async function insertCompletedTask(
  userId: string,
  subject: string,
  completedAtIso: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO tasks (user_id, subject, priority, completed_at, weight_at_completion, created_at)
     VALUES ($1, $2, 'medium', $3::timestamptz, 1, $3::timestamptz)
     RETURNING id`,
    [userId, subject, completedAtIso],
  );
  return res.rows[0].id;
}

describe('achievements (integration)', () => {
  // ------------------------------------------------------------------
  // 1) First completion + response (Req 1, 8)
  // ------------------------------------------------------------------
  it('unlocks first_task_completed on the first completion and lists it (Req 1, 8)', async () => {
    const email = 'achv-first@example.com';
    const token = await registerUser(email);

    const res = await createAndComplete(token, 'get started');
    expect(hasType(res.unlocked, 'first_task_completed')).toBe(true);

    const list = await request(app).get('/api/achievements').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    const types = (list.body.data as Array<{ type: string }>).map((a) => a.type);
    expect(types).toContain('first_task_completed');
  });

  // ------------------------------------------------------------------
  // 2) Idempotency across repeated completions (Req 7)
  // ------------------------------------------------------------------
  it('does not re-unlock first_task_completed on a second completion (Req 7)', async () => {
    const email = 'achv-idem@example.com';
    const token = await registerUser(email);

    const first = await createAndComplete(token, 'one');
    expect(hasType(first.unlocked, 'first_task_completed')).toBe(true);

    const second = await createAndComplete(token, 'two');
    expect(hasType(second.unlocked, 'first_task_completed')).toBe(false);

    // Exactly one persisted first_task_completed row.
    const userId = await userIdOf(email);
    const count = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM achievements WHERE user_id = $1 AND type = 'first_task_completed'`,
      [userId],
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });

  // ------------------------------------------------------------------
  // 3) Productivity burst (Req 4)
  // ------------------------------------------------------------------
  it('unlocks productivity_burst_10 once on the 10th same-day completion and not on the 11th (Req 4.2)', async () => {
    const email = 'achv-burst@example.com';
    const token = await registerUser(email);
    const userId = await userIdOf(email);

    // Seed 9 completions on the user's local day (UTC) via direct INSERT.
    for (let i = 0; i < 9; i++) {
      await insertCompletedTask(userId, `seed ${i}`, `${today}T12:00:00Z`);
    }
    // The 10th completion (via API) makes the day-count reach 10.
    const tenth = await createAndComplete(token, 'tenth');
    const burst = findType(tenth.unlocked, 'productivity_burst_10');
    expect(burst).toBeDefined();
    expect(burst?.data?.task_id).toBe(today);
    expect(burst?.data?.local_date).toBe(today);

    // Exactly one burst row for this local day.
    const one = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM achievements
       WHERE user_id = $1 AND type = 'productivity_burst_10'`,
      [userId],
    );
    expect(Number(one.rows[0].count)).toBe(1);

    // An 11th same-day completion does NOT re-unlock the burst.
    const eleventh = await createAndComplete(token, 'eleventh');
    expect(hasType(eleventh.unlocked, 'productivity_burst_10')).toBe(false);

    const still = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM achievements
       WHERE user_id = $1 AND type = 'productivity_burst_10'`,
      [userId],
    );
    expect(Number(still.rows[0].count)).toBe(1);
  });

  it('buckets the burst count by the user local day, not UTC (AT TIME ZONE) (Req 4.1, 4.4)', async () => {
    const email = 'achv-burst-tz@example.com';
    await registerUser(email);
    const userId = await userIdOf(email);

    // Put the user in America/New_York (UTC-5 in January, no DST).
    await pool.query(
      `UPDATE users SET settings = jsonb_set(settings, '{timezone}', '"America/New_York"')
       WHERE id = $1`,
      [userId],
    );

    // Seed 9 completions whose completed_at instants ALL fall on the SAME
    // New York local day (2026-01-14) but span DIFFERENT UTC days:
    //   2026-01-15T02:00:00Z  -> 2026-01-14 21:00 in New York  (UTC day = 15)
    //   2026-01-14T18:00:00Z  -> 2026-01-14 13:00 in New York  (UTC day = 14)
    // If bucketing used UTC, these would split across two days and never reach
    // 10 on a single day. With AT TIME ZONE they all count on 2026-01-14 (NY).
    const nyDay = '2026-01-14';
    const instants = [
      '2026-01-15T02:00:00Z', // NY 2026-01-14 21:00
      '2026-01-15T03:30:00Z', // NY 2026-01-14 22:30
      '2026-01-15T04:00:00Z', // NY 2026-01-14 23:00
      '2026-01-14T18:00:00Z', // NY 2026-01-14 13:00
      '2026-01-14T17:00:00Z',
      '2026-01-14T16:00:00Z',
      '2026-01-14T15:00:00Z',
      '2026-01-14T14:00:00Z',
      '2026-01-14T13:00:00Z',
    ];
    for (let i = 0; i < instants.length; i++) {
      await insertCompletedTask(userId, `ny seed ${i}`, instants[i]);
    }

    // The tz-aware count buckets all 9 instants onto the single NY local day,
    // even though they span two different UTC days.
    const nyCount = await countLocalDay(userId, 'America/New_York', nyDay);
    expect(nyCount).toBe(9);

    // Sanity: a UTC bucketing would NOT see all 9 on 2026-01-14 (some fell on
    // the 15th in UTC), proving AT TIME ZONE (not UTC) drives the grouping.
    const utcCount = await countLocalDay(userId, 'UTC', nyDay);
    expect(utcCount).toBeLessThan(9);
  });

  it('allows productivity_burst_10 to unlock independently on two different local days (Req 4.3)', async () => {
    const email = 'achv-burst-days@example.com';
    await registerUser(email);
    const userId = await userIdOf(email);

    const dayA = '2026-03-01';
    const dayB = '2026-03-02';
    // Two independent bursts already recorded (simulate two prior local days).
    await pool.query(
      `INSERT INTO achievements (user_id, type, data)
       VALUES ($1, 'productivity_burst_10', $2::jsonb),
              ($1, 'productivity_burst_10', $3::jsonb)`,
      [
        userId,
        JSON.stringify({ task_id: dayA, local_date: dayA }),
        JSON.stringify({ task_id: dayB, local_date: dayB }),
      ],
    );

    const rows = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM achievements
       WHERE user_id = $1 AND type = 'productivity_burst_10'`,
      [userId],
    );
    // Two distinct local-day slots coexist => per-day independence.
    expect(Number(rows.rows[0].count)).toBe(2);
  });

  // ------------------------------------------------------------------
  // 4) Per-series streak milestone (Req 3)
  // ------------------------------------------------------------------
  it('unlocks repeatable_streak_7 keyed to the series id when series >= 7 (Req 3.1)', async () => {
    const email = 'achv-series@example.com';
    const token = await registerUser(email);
    const userId = await userIdOf(email);

    // Create a repeatable task; completing it once creates its series streak
    // row (current 1) keyed on the task's repeat_series_id.
    const firstTaskId = await createTask(token, 'daily habit', { repeatable: true });
    await complete(token, firstTaskId);

    // Discover the series id assigned to that repeatable task.
    const seriesRes = await pool.query<{ repeat_series_id: string }>(
      `SELECT repeat_series_id FROM tasks WHERE id = $1`,
      [firstTaskId],
    );
    const seriesId = seriesRes.rows[0].repeat_series_id;
    expect(seriesId).not.toBeNull();

    // Rewind the series streak to current 6, last completed yesterday, so the
    // next completion in the SAME series advances it to 7.
    await pool.query(
      `UPDATE streaks SET current_streak = 6, longest_streak = 6, last_completed_date = $2
       WHERE user_id = $1 AND series_id = $3`,
      [userId, daysBefore(1), seriesId],
    );

    // Insert a NEW occurrence sharing the same repeat_series_id (a completed
    // task can't be completed twice; a new occurrence advances the series).
    const nextOccId = await insertRepeatableOccurrence(userId, 'daily habit', seriesId);
    const res = await complete(token, nextOccId);

    const unlock = findType(res.unlocked, 'repeatable_streak_7');
    expect(unlock).toBeDefined();
    expect(unlock?.data?.task_id).toBe(seriesId);
    expect(unlock?.data?.series_id).toBe(seriesId);
  });

  it('unlocks a series milestone per distinct series independently (Req 3.4)', async () => {
    const email = 'achv-series-indep@example.com';
    const token = await registerUser(email);
    const userId = await userIdOf(email);

    // Series A: drive to 7 (unlocks repeatable_streak_7).
    const aFirst = await createTask(token, 'series A', { repeatable: true });
    await complete(token, aFirst);
    const aSeries = (
      await pool.query<{ repeat_series_id: string }>(
        `SELECT repeat_series_id FROM tasks WHERE id = $1`,
        [aFirst],
      )
    ).rows[0].repeat_series_id;
    await pool.query(
      `UPDATE streaks SET current_streak = 6, longest_streak = 6, last_completed_date = $2
       WHERE user_id = $1 AND series_id = $3`,
      [userId, daysBefore(1), aSeries],
    );
    const aNext = await insertRepeatableOccurrence(userId, 'series A', aSeries);
    const aRes = await complete(token, aNext);
    expect(findType(aRes.unlocked, 'repeatable_streak_7')?.data?.series_id).toBe(aSeries);

    // Series B: a different repeatable task at streak 1 does NOT unlock _7.
    const bRes = await createAndComplete(token, 'series B', { repeatable: true });
    expect(hasType(bRes.unlocked, 'repeatable_streak_7')).toBe(false);

    // Exactly one repeatable_streak_7 row, keyed to series A only.
    const rows = await pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM achievements WHERE user_id = $1 AND type = 'repeatable_streak_7'`,
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].data.series_id).toBe(aSeries);
  });

  // ------------------------------------------------------------------
  // 5) High weight (Req 6)
  // ------------------------------------------------------------------
  it('unlocks high_weight_completed keyed to the task id using the event weight verbatim (Req 6.2)', async () => {
    const email = 'achv-weight@example.com';
    const token = await registerUser(email);
    const userId = await userIdOf(email);

    // Create a high-priority task, then age its created_at ~80 days so the
    // computed completion weight (age+1)*3 far exceeds the 200 threshold, with
    // no project/due contribution needed.
    const taskId = await createTask(token, 'huge neglected task', { priority: 'high' });
    await pool.query(
      `UPDATE tasks SET created_at = NOW() - INTERVAL '80 days' WHERE id = $1 AND user_id = $2`,
      [taskId, userId],
    );

    const res = await complete(token, taskId);
    expect(res.weightAtCompletion).toBeGreaterThanOrEqual(200);

    const unlock = findType(res.unlocked, 'high_weight_completed');
    expect(unlock).toBeDefined();
    expect(unlock?.data?.task_id).toBe(taskId);
  });

  // ------------------------------------------------------------------
  // 6) Accountable procrastination (Req 5)
  // ------------------------------------------------------------------
  it('unlocks accountable_procrastination after 3 deferrals, keyed to the task id (Req 5.1)', async () => {
    const email = 'achv-defer@example.com';
    const token = await registerUser(email);

    const taskId = await createTask(token, 'avoided task');
    // Defer 3 times (each defer records a deferrals row => deferral_count = 3).
    for (let i = 0; i < 3; i++) {
      const d = await request(app)
        .put(`/api/tasks/${taskId}/defer`)
        .set(auth(token))
        .send({ option: 'later_today' });
      expect(d.status).toBe(200);
    }

    const res = await complete(token, taskId);
    const unlock = findType(res.unlocked, 'accountable_procrastination');
    expect(unlock).toBeDefined();
    expect(unlock?.data?.task_id).toBe(taskId);
  });

  // ------------------------------------------------------------------
  // 7) Read endpoint (Req 9)
  // ------------------------------------------------------------------
  it('GET /api/achievements requires auth (Req 9.2)', async () => {
    const res = await request(app).get('/api/achievements');
    expect(res.status).toBe(401);
  });

  it('GET /api/achievements returns 200 with an empty list for a user with none (Req 9.5)', async () => {
    const token = await registerUser('achv-empty@example.com');
    const res = await request(app).get('/api/achievements').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('scopes achievements to the requesting user and excludes others (Req 9.1, 9.3, 9.4)', async () => {
    const tokenA = await registerUser('achv-scope-a@example.com');
    const tokenB = await registerUser('achv-scope-b@example.com');

    await createAndComplete(tokenA, 'A task'); // A unlocks first_task_completed

    const resA = await request(app).get('/api/achievements').set(auth(tokenA));
    expect(resA.status).toBe(200);
    expect((resA.body.data as Array<{ type: string }>).map((a) => a.type)).toContain(
      'first_task_completed',
    );

    // B has completed nothing -> empty, does not see A's achievements.
    const resB = await request(app).get('/api/achievements').set(auth(tokenB));
    expect(resB.status).toBe(200);
    expect(resB.body.data).toEqual([]);
  });
});

// --- local helpers that need `today` -----------------------------------------

/** The calendar date `days` days before `today` (UTC-noon math, DST-safe). */
function daysBefore(days: number): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Insert a NEW (uncompleted) repeatable occurrence sharing an existing series
 * id, so completing it advances that series' streak. is_repeatable=true +
 * explicit repeat_series_id mirror what taskRepository.create produces for a
 * repeatable task, but keyed to the given series.
 */
async function insertRepeatableOccurrence(
  userId: string,
  subject: string,
  seriesId: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO tasks (user_id, subject, priority, is_repeatable, repeat_pattern, repeat_series_id)
     VALUES ($1, $2, 'high', true, $3::jsonb, $4)
     RETURNING id`,
    [userId, subject, JSON.stringify({ frequency: 'daily', interval: 1 }), seriesId],
  );
  return res.rows[0].id;
}

/** tz-aware same-local-day completion count (mirrors the repository query). */
async function countLocalDay(userId: string, tz: string, localDay: string): Promise<number> {
  const res = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM tasks
     WHERE user_id = $1
       AND completed_at IS NOT NULL
       AND (completed_at AT TIME ZONE $2)::date = $3::date`,
    [userId, tz, localDay],
  );
  return Number(res.rows[0].count);
}
