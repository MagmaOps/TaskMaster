import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import {
  clearCompletionListeners,
  registerCompletionListener,
  type UnlockedAchievement,
} from '../services/completion/completionEvents';
import * as achievementsService from '../services/achievements/achievementsService';

/**
 * Registry-sensitive achievements cases kept in a SEPARATE file so each fully
 * controls the process-global completion-listener registry without disturbing
 * the main [streak, achievements] integration suite:
 *
 *   - Req 10.4: with the streak listener NOT registered, `event.streaks` is
 *     undefined, so the achievements listener evaluates only the non-streak
 *     milestones and skips every streak-based one.
 *   - Req 10.2: a throwing listener is isolated by the completion dispatcher, so
 *     task completion still succeeds (200) and the error is logged.
 *
 * The global setupAfterEnv truncates every data table before each test.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
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

describe('achievements listener — event.streaks undefined (Req 10.4)', () => {
  // Register ONLY the achievements listener (no streak listener), so nothing
  // sets event.streaks. Non-streak milestones must still unlock.
  beforeEach(() => {
    clearCompletionListeners();
    registerCompletionListener(achievementsService.onTaskCompleted);
  });

  it('unlocks non-streak milestones and skips streak milestones when streaks is undefined', async () => {
    const email = 'achv-nostreak@example.com';
    const token = await registerUser(email);
    const userId = (
      await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
    ).rows[0].id;

    // Build a high-weight, heavily-deferred, repeatable task so that IF streaks
    // were present a series milestone could fire — proving it is skipped here.
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'no-streak qualifier', priority: 'high', isRepeatable: true, repeatPattern: { frequency: 'daily', interval: 1 } });
    const taskId = created.body.data.id as string;

    // Age it so the completion weight exceeds the 200 threshold.
    await pool.query(
      `UPDATE tasks SET created_at = NOW() - INTERVAL '80 days' WHERE id = $1`,
      [taskId],
    );
    // Defer 3 times to qualify for accountable_procrastination.
    for (let i = 0; i < 3; i++) {
      await request(app).put(`/api/tasks/${taskId}/defer`).set(auth(token)).send({ option: 'later_today' });
    }
    // Pre-seed a series streak row at 6 so a streak listener WOULD advance it to
    // 7 — but with no streak listener event.streaks stays undefined and no
    // repeatable_streak_* is attempted.
    const seriesId = (
      await pool.query<{ repeat_series_id: string }>(
        `SELECT repeat_series_id FROM tasks WHERE id = $1`,
        [taskId],
      )
    ).rows[0].repeat_series_id;
    await pool.query(
      `INSERT INTO streaks (user_id, series_id, current_streak, longest_streak, last_completed_date)
       VALUES ($1, $2, 6, 6, CURRENT_DATE - 1)`,
      [userId, seriesId],
    );

    const res = await request(app).put(`/api/tasks/${taskId}/complete`).set(auth(token));
    expect(res.status).toBe(200);
    const unlocked = res.body.data.unlocked as UnlockedAchievement[];
    const types = unlocked.map((u) => u.type);

    // Non-streak milestones present.
    expect(types).toContain('first_task_completed');
    expect(types).toContain('high_weight_completed');
    expect(types).toContain('accountable_procrastination');

    // No streak-based milestones attempted.
    expect(types.some((t) => t.startsWith('daily_streak_'))).toBe(false);
    expect(types.some((t) => t.startsWith('repeatable_streak_'))).toBe(false);
  });
});

describe('achievements listener — dispatcher isolation (Req 10.2)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // A single throwing listener stands in for a listener that fails
    // unexpectedly; the dispatcher must catch it and never fail completion.
    clearCompletionListeners();
    registerCompletionListener(async () => {
      throw new Error('boom');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('completion still succeeds (200) and the listener error is logged', async () => {
    const token = await registerUser('achv-isolation@example.com');

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'still completes', priority: 'high' });
    const taskId = created.body.data.id as string;

    const res = await request(app).put(`/api/tasks/${taskId}/complete`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });
});
