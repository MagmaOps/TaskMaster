import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import {
  clearCompletionListeners,
  registerCompletionListener,
} from '../services/completion/completionEvents';
import * as recurrenceService from '../services/tasks/recurrenceService';
import { addDays, nextDueDate } from '../services/tasks/recurrence';
import { localCalendarDate } from '../services/time/userTime';
import type { RepeatPattern } from '../types/task';

/**
 * Integration tests for task recurrence (the completion-listener side).
 *
 * Determinism follows the listener-reset pattern: because recurrence is
 * order-independent (it reads only `event.task` + the user's timezone, never
 * `event.streaks`/`event.unlocked`), the suite resets the process-global
 * listener registry to EXACTLY the recurrence listener. No other listener is
 * needed. The global setupAfterEnv truncates every data table before each test,
 * so each `it` starts from a clean DB with fresh per-test users.
 *
 * The test env user timezone defaults to 'UTC', so the fallback "today" equals
 * localCalendarDate('UTC') unless a test overrides settings.timezone directly.
 *
 * Precise control of due_date / repeat_pattern / timezone is done via direct
 * pool.query setup; the actual completion is always driven through the API so
 * the real listener runs on the real CompletionEvent. DATE columns are read
 * back with a ::text cast to get an unambiguous 'YYYY-MM-DD' (pg otherwise
 * returns a JS Date at server-local midnight).
 */
let app: Application;

/** Register the recurrence listener as the only completion listener. */
function useRecurrenceListenerOnly(): void {
  clearCompletionListeners();
  registerCompletionListener(recurrenceService.onTaskCompleted);
}

beforeAll(() => {
  app = createApp();
  useRecurrenceListenerOnly();
});

async function registerUser(email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'hunter2pass' });
  const token = res.body.data.accessToken as string;
  const userId = (
    await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  ).rows[0].id;
  return { token, userId };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createProject(token: string, name: string): Promise<string> {
  const res = await request(app).post('/api/projects').set(auth(token)).send({ name });
  return res.body.data.id as string;
}

/**
 * Create a repeatable task via the API (create mints a fresh repeat_series_id),
 * then precisely seed its due_date / due_time / repeat_pattern via pool.query so
 * scenarios (end_date, days_of_week, null due_date) are fully controlled.
 * Returns the task id and its repeat_series_id.
 */
async function createSeededRepeatable(
  token: string,
  opts: {
    subject: string;
    priority?: 'high' | 'medium' | 'low';
    dueDate: string | null;
    dueTime?: string | null;
    pattern: RepeatPattern;
    projectIds?: string[];
  },
): Promise<{ id: string; seriesId: string }> {
  const created = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({
      subject: opts.subject,
      priority: opts.priority ?? 'high',
      isRepeatable: true,
      repeatPattern: { frequency: 'daily', interval: 1 },
      ...(opts.projectIds ? { projectIds: opts.projectIds } : {}),
    });
  const id = created.body.data.id as string;

  // Seed the exact due_date / due_time / repeat_pattern jsonb for full control.
  await pool.query(
    `UPDATE tasks SET due_date = $2, due_time = $3, repeat_pattern = $4::jsonb WHERE id = $1`,
    [id, opts.dueDate, opts.dueTime ?? null, JSON.stringify(opts.pattern)],
  );

  const seriesId = (
    await pool.query<{ repeat_series_id: string }>(
      'SELECT repeat_series_id FROM tasks WHERE id = $1',
      [id],
    )
  ).rows[0].repeat_series_id;
  return { id, seriesId };
}

interface OccurrenceRow {
  id: string;
  subject: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  repeat_pattern: RepeatPattern | null;
  is_repeatable: boolean;
  completed_at: Date | null;
  archived_at: Date | null;
}

/**
 * Active occurrences in a series other than `excludeId`. `due_date` is cast to
 * text so it comes back as a clean 'YYYY-MM-DD' (avoids the pg Date-object
 * server-local-midnight ambiguity); `due_time` is trimmed to 'HH:MM'.
 */
async function activeOccurrences(seriesId: string, excludeId: string): Promise<OccurrenceRow[]> {
  const res = await pool.query<OccurrenceRow>(
    `SELECT id, subject, priority, due_date::text AS due_date,
            to_char(due_time, 'HH24:MI') AS due_time,
            repeat_pattern, is_repeatable, completed_at, archived_at
       FROM tasks
      WHERE repeat_series_id = $1
        AND id <> $2
        AND completed_at IS NULL
        AND archived_at IS NULL
      ORDER BY created_at`,
    [seriesId, excludeId],
  );
  return res.rows;
}

/** Project ids linked to a task, sorted for stable comparison. */
async function projectIdsOf(taskId: string): Promise<string[]> {
  const res = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM task_projects WHERE task_id = $1 ORDER BY project_id',
    [taskId],
  );
  return res.rows.map((r) => r.project_id);
}

async function complete(token: string, taskId: string): Promise<request.Response> {
  return request(app).put(`/api/tasks/${taskId}/complete`).set(auth(token));
}

describe('task recurrence (integration)', () => {
  // Req 1, 2, 3, 6.3: daily task with a due_date + projects → one new active
  // occurrence, all defining fields copied, due_date = anchor + interval, and
  // the original stays completed/unchanged.
  it('generates the next daily occurrence with copied fields and advanced due_date', async () => {
    const { token } = await registerUser('rec-daily@example.com');
    const p1 = await createProject(token, 'Alpha');
    const p2 = await createProject(token, 'Beta');
    const dueDate = localCalendarDate('UTC');
    const pattern: RepeatPattern = { frequency: 'daily', interval: 1 };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'water the plants',
      priority: 'medium',
      dueDate,
      dueTime: '09:30',
      pattern,
      projectIds: [p1, p2],
    });

    const res = await complete(token, id);
    expect(res.status).toBe(200);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(1);
    const next = occ[0];
    expect(next.subject).toBe('water the plants');
    expect(next.priority).toBe('medium');
    expect(next.due_time).toBe('09:30');
    expect(next.is_repeatable).toBe(true);
    expect(next.repeat_pattern).toEqual(pattern);
    expect(next.completed_at).toBeNull();
    expect(next.archived_at).toBeNull();
    expect(next.due_date).toBe(addDays(dueDate, 1));

    // Same project set (by id) as the completed task.
    expect(await projectIdsOf(next.id)).toEqual([p1, p2].sort());

    // Original stays completed and otherwise unchanged (Req 6.3).
    const original = (
      await pool.query<{
        completed_at: Date | null;
        subject: string;
        due_date: string | null;
      }>(
        `SELECT completed_at, subject, due_date::text AS due_date FROM tasks WHERE id = $1`,
        [id],
      )
    ).rows[0];
    expect(original.completed_at).not.toBeNull();
    expect(original.subject).toBe('water the plants');
    expect(original.due_date).toBe(dueDate);
  });

  // Req 4.1/4.3: weekly with days_of_week → the next scheduled weekday
  // (nextDueDate is the oracle for the expected date).
  it('generates the next weekly occurrence on the next scheduled weekday', async () => {
    const { token } = await registerUser('rec-weekly-dow@example.com');
    // A fixed anchor so the assertion is stable regardless of "today".
    const dueDate = '2024-06-03'; // Monday
    const pattern: RepeatPattern = { frequency: 'weekly', days_of_week: [1, 3, 5] };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'gym session',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(1);
    // Oracle: earliest listed weekday strictly after the anchor.
    expect(occ[0].due_date).toBe(nextDueDate(pattern, dueDate));
    // Sanity: Monday(2024-06-03) → Wednesday(2024-06-05).
    expect(occ[0].due_date).toBe('2024-06-05');
  });

  // Req 4.2: weekly with empty/omitted days_of_week → interval fallback of
  // 7 * interval days from the anchor.
  it('advances a weekly occurrence by 7 * interval days when days_of_week is empty', async () => {
    const { token } = await registerUser('rec-weekly-interval@example.com');
    const dueDate = '2024-06-03';
    const pattern: RepeatPattern = { frequency: 'weekly', interval: 2, days_of_week: [] };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'biweekly review',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(1);
    expect(occ[0].due_date).toBe(addDays(dueDate, 14));
  });

  // Req 3.3, 8.1: null due_date + non-UTC user timezone → anchor is the user's
  // local completion day, and next = localCalendarDate(tz) + interval.
  it('falls back to the user local completion day (non-UTC tz) when due_date is null', async () => {
    const { token, userId } = await registerUser('rec-anchor-fallback@example.com');
    const tz = 'America/New_York';
    await pool.query(
      `UPDATE users SET settings = jsonb_set(settings, '{timezone}', '"America/New_York"') WHERE id = $1`,
      [userId],
    );
    const pattern: RepeatPattern = { frequency: 'daily', interval: 2 };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'undated habit',
      dueDate: null,
      pattern,
    });

    await complete(token, id);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(1);
    // Anchor = local day in the user's zone; advance by interval (2).
    expect(occ[0].due_date).toBe(addDays(localCalendarDate(tz), 2));
  });

  // Req 5.1: computed next (due_date + 1) strictly AFTER end_date → no new row.
  it('stops the series when the next date would exceed end_date', async () => {
    const { token } = await registerUser('rec-enddate-stop@example.com');
    const dueDate = '2024-06-10';
    // next = 2024-06-11 > end_date 2024-06-10 → schedule ended.
    const pattern: RepeatPattern = {
      frequency: 'daily',
      interval: 1,
      end_date: '2024-06-10',
    };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'ends today',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(0);
  });

  // Req 5.2: boundary — next == end_date → one occurrence IS created.
  it('creates the occurrence when the next date equals end_date (boundary)', async () => {
    const { token } = await registerUser('rec-enddate-boundary@example.com');
    const dueDate = '2024-06-10';
    // next = 2024-06-11 == end_date → still within the schedule.
    const pattern: RepeatPattern = {
      frequency: 'daily',
      interval: 1,
      end_date: '2024-06-11',
    };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'ends tomorrow',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const occ = await activeOccurrences(seriesId, id);
    expect(occ).toHaveLength(1);
    expect(occ[0].due_date).toBe('2024-06-11');
  });

  // Req 1.2/1.3: a plain non-repeatable task → no new occurrence anywhere.
  it('does not generate an occurrence for a non-repeatable task', async () => {
    const { token, userId } = await registerUser('rec-nonrepeatable@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'one-off', priority: 'high', dueDate: localCalendarDate('UTC') });
    const id = created.body.data.id as string;

    await complete(token, id);

    // No other active task exists for this user beyond the (now-completed) original.
    const active = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM tasks
        WHERE user_id = $1 AND id <> $2 AND completed_at IS NULL AND archived_at IS NULL`,
      [userId, id],
    );
    expect(active.rows[0].cnt).toBe('0');
  });

  // Req 1.3: repeatable flag but null repeat_pattern → no new occurrence.
  it('does not generate an occurrence when repeat_pattern is null', async () => {
    const { token, userId } = await registerUser('rec-nullpattern@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({
        subject: 'flagged but no pattern',
        priority: 'high',
        isRepeatable: true,
        repeatPattern: { frequency: 'daily', interval: 1 },
      });
    const id = created.body.data.id as string;
    // Force the pattern to null while keeping is_repeatable true.
    await pool.query(`UPDATE tasks SET repeat_pattern = NULL, due_date = $2 WHERE id = $1`, [
      id,
      localCalendarDate('UTC'),
    ]);

    await complete(token, id);

    const active = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM tasks
        WHERE user_id = $1 AND id <> $2 AND completed_at IS NULL AND archived_at IS NULL`,
      [userId, id],
    );
    expect(active.rows[0].cnt).toBe('0');
  });

  // Req 6.2: completing the generated occurrence continues the series, advancing
  // the date again within the same repeat_series_id.
  it('continues the series when the generated occurrence is completed', async () => {
    const { token } = await registerUser('rec-continue@example.com');
    const dueDate = '2024-06-01';
    const pattern: RepeatPattern = { frequency: 'daily', interval: 1 };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'daily stretch',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const firstGen = await activeOccurrences(seriesId, id);
    expect(firstGen).toHaveLength(1);
    expect(firstGen[0].due_date).toBe(addDays(dueDate, 1)); // 2024-06-02
    const genId = firstGen[0].id;

    // Complete the generated occurrence → the following occurrence appears.
    await complete(token, genId);

    // Now the only active occurrence in the series (excluding both completed
    // ones) is the third, advanced from the second.
    const second = await pool.query<OccurrenceRow>(
      `SELECT id, due_date::text AS due_date FROM tasks
        WHERE repeat_series_id = $1 AND id NOT IN ($2, $3)
          AND completed_at IS NULL AND archived_at IS NULL
        ORDER BY created_at`,
      [seriesId, id, genId],
    );
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].due_date).toBe(addDays(dueDate, 2)); // 2024-06-03
  });

  // Req 6.1: a single completion yields exactly ONE new active row in the series.
  it('inserts exactly one new active row per completion', async () => {
    const { token } = await registerUser('rec-single@example.com');
    const dueDate = localCalendarDate('UTC');
    const pattern: RepeatPattern = { frequency: 'daily', interval: 1 };

    const { id, seriesId } = await createSeededRepeatable(token, {
      subject: 'single insert',
      dueDate,
      pattern,
    });

    await complete(token, id);

    const count = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM tasks
        WHERE repeat_series_id = $1 AND id <> $2
          AND completed_at IS NULL AND archived_at IS NULL`,
      [seriesId, id],
    );
    expect(count.rows[0].cnt).toBe('1');
  });
});

// Req 7.2: dispatcher isolation. A throwing listener stands in for a listener
// that fails unexpectedly; the completion dispatcher must catch it so completion
// still succeeds (200) and the error is logged. This block owns the global
// listener registry for its lifetime and restores the recurrence-only registry
// afterward so it does not leak into other suites.
describe('task recurrence — dispatcher isolation (Req 7.2)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    clearCompletionListeners();
    registerCompletionListener(async () => {
      throw new Error('boom');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  afterAll(() => {
    // Restore the suite-wide recurrence-only registry.
    useRecurrenceListenerOnly();
  });

  it('completion still succeeds (200) and the listener error is logged', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'rec-isolation@example.com', password: 'hunter2pass' });
    const token = res.body.data.accessToken as string;

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'still completes', priority: 'high' });
    const taskId = created.body.data.id as string;

    const completed = await request(app)
      .put(`/api/tasks/${taskId}/complete`)
      .set(auth(token));
    expect(completed.status).toBe(200);
    expect(completed.body.success).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });
});
