import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import { localCalendarDate } from '../services/time/userTime';
import type { ProjectAnalytics } from '../services/analytics/analyticsService';

/**
 * Integration tests for GET /api/analytics/projects (Jest + Supertest) against
 * the ephemeral test DB. The global setupAfterEnv TRUNCATEs every data table
 * before each test, so each `it` starts from a clean DB with fresh per-test
 * users.
 *
 * Endpoint contract (design.md): behind authMiddleware, returns
 * `200 { success: true, data: ProjectAnalytics[] }` where each row is
 * `{ projectId, name, priorityOrder, color, tasksCompleted, weightCompleted,
 *   lastCompletionDate }`, ordered by `priority_order` ascending. Every user has
 * an Unassigned (is_default) project at priority_order 0, so that row is always
 * FIRST — analytics rows are therefore selected by projectId/name, NEVER by
 * array index.
 *
 * Seeding strategy:
 * - Real completions run through the real API (POST /api/tasks + PUT
 *   /api/tasks/:id/complete); the complete response's `data.weightAtCompletion`
 *   is summed as the oracle for `weightCompleted` (it is exactly what the
 *   aggregate SUMs).
 * - The timezone / cross-midnight case seeds `completed_at` directly via
 *   pool.query for a precise instant and sets the user's timezone in the
 *   settings JSONB, so the local-day conversion is deterministic (no `fc`).
 * - Archived-then-completed exclusion is seeded via pool.query.
 *
 * ::text / ::int casts are used where reading numbers back directly from pg.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
});

/** Register a user; return the access token and the user's id. */
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

async function createProject(token: string, name: string, color?: string) {
  return request(app).post('/api/projects').set(auth(token)).send({ name, color });
}

/** Create a task (optionally assigned to projectIds) and return its id. */
async function createTask(
  token: string,
  subject: string,
  projectIds?: string[],
): Promise<string> {
  const res = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({ subject, priority: 'high', ...(projectIds ? { projectIds } : {}) });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/** Complete a task and return the persisted weight_at_completion. */
async function completeTask(token: string, taskId: string): Promise<number> {
  const done = await request(app).put(`/api/tasks/${taskId}/complete`).set(auth(token));
  expect(done.status).toBe(200);
  return done.body.data.weightAtCompletion as number;
}

/**
 * Create + complete a task assigned to `projectIds` (or Unassigned when
 * omitted); return its weight_at_completion.
 */
async function createAndComplete(
  token: string,
  subject: string,
  projectIds?: string[],
): Promise<number> {
  const id = await createTask(token, subject, projectIds);
  return completeTask(token, id);
}

/** GET /api/analytics/projects for a token. */
async function getAnalytics(token: string) {
  return request(app).get('/api/analytics/projects').set(auth(token));
}

/** The user's Unassigned (is_default) project id/name from the DB. */
async function defaultProject(userId: string): Promise<{ id: string; name: string }> {
  const res = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE user_id = $1 AND is_default`,
    [userId],
  );
  return res.rows[0];
}

/** Find the analytics row for a project by id (never by array index). */
function rowById(data: ProjectAnalytics[], projectId: string): ProjectAnalytics {
  const row = data.find((r) => r.projectId === projectId);
  expect(row).toBeDefined();
  return row as ProjectAnalytics;
}

/** Set the user's timezone in the settings JSONB document. */
async function setUserTimezone(userId: string, tz: string): Promise<void> {
  await pool.query(
    `UPDATE users SET settings = jsonb_set(settings, '{timezone}', to_jsonb($2::text)) WHERE id = $1`,
    [userId, tz],
  );
}

describe('analytics (integration) — GET /api/analytics/projects', () => {
  // Req 1, 3.3: shape + per-project count/weight aggregation. Rows are selected
  // by projectId (Unassigned is first, so index-based selection would be wrong).
  it('returns 200 { success, data } with per-project counts, weight, and fields', async () => {
    const { token } = await registerUser('an-shape@example.com');
    const work = (await createProject(token, 'Work', '#ff0000')).body.data;
    const personal = (await createProject(token, 'Personal')).body.data;

    // Two completions in Work, one in Personal — sum the returned weights.
    const wWork = (await createAndComplete(token, 'w1', [work.id]))
      + (await createAndComplete(token, 'w2', [work.id]));
    const wPersonal = await createAndComplete(token, 'p1', [personal.id]);

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data as ProjectAnalytics[];

    const workRow = rowById(data, work.id);
    expect(workRow.tasksCompleted).toBe(2);
    expect(workRow.weightCompleted).toBe(wWork);
    expect(workRow.name).toBe('Work');
    expect(workRow.priorityOrder).toBe(1);
    expect(workRow.color).toBe('#ff0000');
    expect(typeof workRow.lastCompletionDate).toBe('string');

    const personalRow = rowById(data, personal.id);
    expect(personalRow.tasksCompleted).toBe(1);
    expect(personalRow.weightCompleted).toBe(wPersonal);
    expect(personalRow.name).toBe('Personal');
    expect(personalRow.priorityOrder).toBe(2);
  });

  // Req 3.1: a real project with no completions still appears, zeroed.
  it('includes a project with no completions as zeros with null lastCompletionDate', async () => {
    const { token } = await registerUser('an-empty@example.com');
    const empty = (await createProject(token, 'Empty')).body.data;

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const row = rowById(res.body.data as ProjectAnalytics[], empty.id);
    expect(row.tasksCompleted).toBe(0);
    expect(row.weightCompleted).toBe(0);
    expect(row.lastCompletionDate).toBeNull();
  });

  // Req 3.2: a completed task with NO projectIds lands in the Unassigned project
  // and its effort surfaces on that project's row (no synthetic bucket). Every
  // analytics row corresponds to a real owned project row (verified by id set).
  it('rolls unassigned completions up into the Unassigned project row', async () => {
    const { token, userId } = await registerUser('an-unassigned@example.com');
    const def = await defaultProject(userId);

    const weight = await createAndComplete(token, 'no project'); // Unassigned only

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const data = res.body.data as ProjectAnalytics[];

    const unassignedRow = rowById(data, def.id);
    expect(unassignedRow.name).toBe('Unassigned');
    expect(unassignedRow.priorityOrder).toBe(0);
    expect(unassignedRow.tasksCompleted).toBeGreaterThanOrEqual(1);
    expect(unassignedRow.weightCompleted).toBe(weight);

    // No synthetic bucket: every returned projectId is a real owned project row.
    const owned = (
      await pool.query<{ id: string }>('SELECT id FROM projects WHERE user_id = $1', [userId])
    ).rows.map((r) => r.id);
    for (const r of data) {
      expect(owned).toContain(r.projectId);
    }
    expect(data).toHaveLength(owned.length);
  });

  // Req 1.4 (DD-2): a completed task in two projects counts in each.
  it('counts a multi-project completion in every associated project', async () => {
    const { token } = await registerUser('an-multi@example.com');
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;

    const weight = await createAndComplete(token, 'shared', [a.id, b.id]);

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const data = res.body.data as ProjectAnalytics[];

    const rowA = rowById(data, a.id);
    const rowB = rowById(data, b.id);
    expect(rowA.tasksCompleted).toBe(1);
    expect(rowA.weightCompleted).toBe(weight);
    expect(rowB.tasksCompleted).toBe(1);
    expect(rowB.weightCompleted).toBe(weight);
  });

  // Req 1.5: active and archived tasks never count — only completed non-archived.
  it('excludes active and archived (incl. completed-then-archived) tasks', async () => {
    const { token, userId } = await registerUser('an-exclude@example.com');
    const proj = (await createProject(token, 'Mixed')).body.data;

    // One real completion (counts).
    const weight = await createAndComplete(token, 'counts', [proj.id]);

    // One active task in the project (left incomplete) — must not count.
    await createTask(token, 'active', [proj.id]);

    // One task archived via the DELETE endpoint (soft-archive) — must not count.
    const archivedId = await createTask(token, 'to-archive', [proj.id]);
    const del = await request(app).delete(`/api/tasks/${archivedId}`).set(auth(token));
    expect(del.status).toBe(204);
    // Verify the DELETE endpoint soft-archives (sets archived_at) rather than
    // hard-deleting the row.
    const archivedRow = await pool.query<{ archived_at: Date | null }>(
      'SELECT archived_at FROM tasks WHERE id = $1',
      [archivedId],
    );
    expect(archivedRow.rows).toHaveLength(1);
    expect(archivedRow.rows[0].archived_at).not.toBeNull();

    // One completed-then-archived task seeded directly — must also be excluded.
    const seededId = await createTask(token, 'completed-then-archived', [proj.id]);
    await pool.query(
      `UPDATE tasks SET completed_at = NOW(), weight_at_completion = 999, archived_at = NOW() WHERE id = $1`,
      [seededId],
    );

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const row = rowById(res.body.data as ProjectAnalytics[], proj.id);
    expect(row.tasksCompleted).toBe(1);
    expect(row.weightCompleted).toBe(weight);
    void userId;
  });

  // Req 2, DD-4: lastCompletionDate is the user-local calendar day of the latest
  // completion instant. An instant of 2024-01-15T02:00:00Z is 2024-01-14 in
  // America/New_York (UTC-5 in January) — proving the service converts the
  // instant to the user's zone rather than truncating in UTC.
  it('reports lastCompletionDate as the user-local day across midnight (non-UTC tz)', async () => {
    const { token, userId } = await registerUser('an-tz@example.com');
    await setUserTimezone(userId, 'America/New_York');
    const proj = (await createProject(token, 'TZ')).body.data;

    const instant = new Date('2024-01-15T02:00:00Z'); // 2024-01-14 21:00 in NY
    const taskId = await createTask(token, 'seeded completion', [proj.id]);
    await pool.query(
      `UPDATE tasks SET completed_at = $2, weight_at_completion = 10 WHERE id = $1`,
      [taskId, instant],
    );

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const row = rowById(res.body.data as ProjectAnalytics[], proj.id);
    expect(row.tasksCompleted).toBe(1);
    // Oracle: the same helper the service uses, plus the literal expected day.
    expect(row.lastCompletionDate).toBe(localCalendarDate('America/New_York', instant));
    expect(row.lastCompletionDate).toBe('2024-01-14');
  });

  // Req 4.1: rows are ordered by priority_order ascending, with the Unassigned
  // project (priority_order 0) first — even after a reorder.
  it('orders rows by priorityOrder ascending with Unassigned first', async () => {
    const { token } = await registerUser('an-order@example.com');
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;
    const c = (await createProject(token, 'C')).body.data;

    // Reorder the real projects to C, A, B (Unassigned stays at 0).
    const reorder = await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [c.id, a.id, b.id] });
    expect(reorder.status).toBe(200);

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const data = res.body.data as ProjectAnalytics[];

    // Ascending by priorityOrder.
    const orders = data.map((r) => r.priorityOrder);
    const sorted = [...orders].sort((x, y) => x - y);
    expect(orders).toEqual(sorted);

    // Unassigned is first at 0; the reordered real projects follow.
    expect(data[0].name).toBe('Unassigned');
    expect(data[0].priorityOrder).toBe(0);
    expect(data.map((r) => r.name)).toEqual(['Unassigned', 'C', 'A', 'B']);
  });

  // Req 5: auth + user scoping.
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/analytics/projects');
    expect(res.status).toBe(401);
  });

  it('scopes analytics to the requesting user (other user excluded)', async () => {
    const { token: tokenA } = await registerUser('an-scope-a@example.com');
    const { token: tokenB } = await registerUser('an-scope-b@example.com');

    const projA = (await createProject(tokenA, 'A-only')).body.data;
    await createAndComplete(tokenA, 'a-task', [projA.id]);

    // User B has their own project + completion; must not leak into A.
    const projB = (await createProject(tokenB, 'B-only')).body.data;
    await createAndComplete(tokenB, 'b-task', [projB.id]);

    const res = await getAnalytics(tokenA);
    expect(res.status).toBe(200);
    const data = res.body.data as ProjectAnalytics[];
    // None of B's projects appear in A's analytics.
    expect(data.find((r) => r.projectId === projB.id)).toBeUndefined();
    // A's own project is present and counted.
    expect(rowById(data, projA.id).tasksCompleted).toBe(1);
  });

  // Req 5.4 NUANCE: the requirement text says "owns no projects -> empty list",
  // but after the projects-management revision EVERY user always has an
  // Unassigned (is_default) project. So a brand-new user with no Real_Projects
  // does NOT get an empty list — they get exactly one row: the Unassigned
  // project (zeroed). This supersedes the literal "empty list" wording; the
  // response is still 200 and contains only that single Unassigned row.
  it('returns exactly the Unassigned row (not empty) for a user with no real projects', async () => {
    const { token, userId } = await registerUser('an-noprojects@example.com');
    const def = await defaultProject(userId);

    const res = await getAnalytics(token);
    expect(res.status).toBe(200);
    const data = res.body.data as ProjectAnalytics[];
    expect(data).toHaveLength(1);
    expect(data[0].projectId).toBe(def.id);
    expect(data[0].name).toBe('Unassigned');
    expect(data[0].priorityOrder).toBe(0);
    expect(data[0].tasksCompleted).toBe(0);
    expect(data[0].weightCompleted).toBe(0);
    expect(data[0].lastCompletionDate).toBeNull();
  });
});
