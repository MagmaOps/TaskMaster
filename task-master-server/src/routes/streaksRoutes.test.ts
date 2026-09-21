import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import {
  clearCompletionListeners,
  registerCompletionListener,
} from '../services/completion/completionEvents';
import * as streakService from '../services/streaks/streakService';
import { localCalendarDate } from '../services/time/userTime';

/**
 * Integration tests for streaks. To be deterministic regardless of what other
 * suites did to the global listener registry, this suite resets the listeners
 * to exactly the streak listener (the established pattern from the economy
 * suite). The test env's user timezone defaults to 'UTC', so the user's local
 * "today" equals localCalendarDate('UTC'); "yesterday"/"gap" are simulated by
 * setting last_completed_date directly relative to that.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
  clearCompletionListeners();
  registerCompletionListener(streakService.onTaskCompleted);
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

/** Create a task (optionally repeatable) and complete it. Returns the task id. */
async function createAndComplete(
  token: string,
  subject: string,
  opts: { repeatable?: boolean } = {},
): Promise<string> {
  const body: Record<string, unknown> = { subject, priority: 'high' };
  if (opts.repeatable) {
    body.isRepeatable = true;
    body.repeatPattern = { frequency: 'daily', interval: 1 };
  }
  const created = await request(app).post('/api/tasks').set(auth(token)).send(body);
  const id = created.body.data.id as string;
  await request(app).put(`/api/tasks/${id}/complete`).set(auth(token));
  return id;
}

/** The user's local "today" in the test env (timezone defaults to UTC). */
const today = localCalendarDate('UTC');
/** The calendar date `days` days before `today` (UTC-noon math, DST-safe). */
function daysBefore(days: number): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Directly rewrite the daily streak row for a user (simulate history). */
async function setDailyStreak(
  email: string,
  lastCompletedDate: string,
  current: number,
  longest: number,
): Promise<void> {
  await pool.query(
    `UPDATE streaks
       SET last_completed_date = $2, current_streak = $3, longest_streak = $4
     WHERE user_id = (SELECT id FROM users WHERE email = $1) AND series_id IS NULL`,
    [email, lastCompletedDate, current, longest],
  );
}

describe('streaks (integration)', () => {
  // Requirement 1: daily streak starts at 1 on first completion today.
  it('completing a task today starts the daily streak at 1', async () => {
    const token = await registerUser('streak1@example.com');
    await createAndComplete(token, 'do it today');

    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.daily.current).toBe(1);
    expect(res.body.data.daily.longest).toBe(1);
    expect(res.body.data.daily.lastCompletedDate).toBe(today);
  });

  // Requirement 1.3: last_completed_date == yesterday -> increment.
  it('advances the daily streak to 2 when the last completion was yesterday', async () => {
    const email = 'streak2@example.com';
    const token = await registerUser(email);
    await createAndComplete(token, 'seed row'); // creates today's daily row, current 1
    await setDailyStreak(email, daysBefore(1), 1, 1); // rewind to yesterday
    await createAndComplete(token, 'advance');

    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.data.daily.current).toBe(2);
    expect(res.body.data.daily.longest).toBe(2);
    expect(res.body.data.daily.lastCompletedDate).toBe(today);
  });

  // Requirement 1.4 + 1.5: a gap resets current to 1 but longest is retained.
  it('resets the daily streak on a gap while retaining longest', async () => {
    const email = 'streak3@example.com';
    const token = await registerUser(email);
    await createAndComplete(token, 'seed row');
    await setDailyStreak(email, daysBefore(3), 5, 5); // 3-day gap, prior best 5
    await createAndComplete(token, 'after gap');

    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.data.daily.current).toBe(1);
    expect(res.body.data.daily.longest).toBe(5);
    expect(res.body.data.daily.lastCompletedDate).toBe(today);
  });

  // Requirement 5.3: idempotent within a single day.
  it('is idempotent within the same day (two completions today -> current 1)', async () => {
    const token = await registerUser('streak4@example.com');
    await createAndComplete(token, 'first today');
    await createAndComplete(token, 'second today');

    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.data.daily.current).toBe(1);
    expect(res.body.data.daily.longest).toBe(1);
  });

  // Requirement 2: per-series streaks are independent and labelled by subject.
  it('tracks independent per-series streaks for repeatable tasks with subject labels', async () => {
    const token = await registerUser('streak5@example.com');
    await createAndComplete(token, 'morning workout', { repeatable: true });
    await createAndComplete(token, 'read a book', { repeatable: true });

    const res = await request(app).get('/api/streaks').set(auth(token));
    const series = res.body.data.series as Array<{
      seriesId: string;
      label: string;
      current: number;
      longest: number;
      lastCompletedDate: string;
    }>;

    expect(series).toHaveLength(2);
    for (const entry of series) {
      expect(entry.current).toBe(1);
      expect(entry.longest).toBe(1);
      expect(entry.lastCompletedDate).toBe(today);
    }
    const labels = series.map((s) => s.label).sort();
    expect(labels).toEqual(['morning workout', 'read a book']);
    // Independent series ids.
    expect(series[0].seriesId).not.toBe(series[1].seriesId);
  });

  // Requirement 2.2: a non-repeatable completion does not create a series row.
  it('does not create a per-series streak for a non-repeatable completion', async () => {
    const token = await registerUser('streak6@example.com');
    await createAndComplete(token, 'habit', { repeatable: true });

    let res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.data.series).toHaveLength(1);

    await createAndComplete(token, 'one-off'); // non-repeatable

    res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.data.series).toHaveLength(1); // unchanged
  });

  // Requirement 3.1/3.2: response shape and per-series entry fields.
  it('returns the { daily, series } shape with fully-populated per-series entries', async () => {
    const token = await registerUser('streak7@example.com');
    await createAndComplete(token, 'shape habit', { repeatable: true });

    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('daily');
    expect(res.body.data).toHaveProperty('series');

    const entry = res.body.data.series[0];
    expect(entry).toEqual(
      expect.objectContaining({
        seriesId: expect.any(String),
        label: 'shape habit',
        current: expect.any(Number),
        longest: expect.any(Number),
        lastCompletedDate: expect.any(String),
      }),
    );
  });

  // Requirement 3.3: empty for a fresh user who never completed anything.
  it('returns null daily and empty series for a fresh user', async () => {
    const token = await registerUser('streak8@example.com');
    const res = await request(app).get('/api/streaks').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.daily).toBeNull();
    expect(res.body.data.series).toEqual([]);
  });

  // Requirement 3.4: 401 without a token.
  it('requires auth', async () => {
    const res = await request(app).get('/api/streaks');
    expect(res.status).toBe(401);
  });

  // Requirement 3.4: data is user-scoped.
  it('is user-scoped (user B does not see user A streaks)', async () => {
    const tokenA = await registerUser('streak9a@example.com');
    const tokenB = await registerUser('streak9b@example.com');
    await createAndComplete(tokenA, 'A only', { repeatable: true });

    const resB = await request(app).get('/api/streaks').set(auth(tokenB));
    expect(resB.body.data.daily).toBeNull();
    expect(resB.body.data.series).toEqual([]);

    const resA = await request(app).get('/api/streaks').set(auth(tokenA));
    expect(resA.body.data.daily.current).toBe(1);
    expect(resA.body.data.series).toHaveLength(1);
  });
});
