import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';

/**
 * Integration tests for the per-user **Unassigned** project (Requirements 8-12)
 * against the ephemeral test DB. The global setupAfterEnv truncates every data
 * table before each test, so each `it` starts from a clean DB with fresh
 * per-test users.
 *
 * Behavior under test (production already in place):
 * - Registering a user creates exactly one `is_default` Unassigned project
 *   (order 0) via projectRepo.ensureDefault.
 * - GET /api/projects returns the Unassigned project first with isDefault:true.
 * - Task membership is exclusive+total: a task is in one-or-more Real_Projects
 *   XOR the Unassigned project — never both, never empty.
 * - Clients cannot supply the Unassigned id in a task's projectIds (400).
 * - The Unassigned project is protected: delete/rename/reorder → 400, and its
 *   name is reserved (409).
 * - The 20-project maximum counts Real_Projects only.
 * - The Unassigned project is weight-neutral (no project multiplier applied).
 *
 * Assertions read task_projects / projects directly via pool.query; scenarios
 * are driven through the API where possible so the real service/repository code
 * runs. priority_order is read back with a ::text cast to avoid pg numeric
 * ambiguity where relevant.
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

/** The user's Unassigned (is_default) project row, straight from the DB. */
async function defaultProject(
  userId: string,
): Promise<{ id: string; name: string; priority_order: number }> {
  const res = await pool.query<{ id: string; name: string; priority_order: number }>(
    `SELECT id, name, priority_order::int AS priority_order
       FROM projects WHERE user_id = $1 AND is_default`,
    [userId],
  );
  return res.rows[0];
}

/** Project ids linked to a task, sorted for stable comparison. */
async function membershipOf(taskId: string): Promise<string[]> {
  const res = await pool.query<{ project_id: string }>(
    'SELECT project_id FROM task_projects WHERE task_id = $1 ORDER BY project_id',
    [taskId],
  );
  return res.rows.map((r) => r.project_id);
}

describe('Unassigned project — user creation', () => {
  // Req 8.1/8.2: registering creates exactly one Unassigned project.
  it('creates exactly one Unassigned project (is_default, order 0) on registration', async () => {
    const { userId } = await registerUser('u-create@example.com');

    const rows = (
      await pool.query<{ id: string; name: string; priority_order: number }>(
        `SELECT id, name, priority_order::int AS priority_order
           FROM projects WHERE user_id = $1 AND is_default = true`,
        [userId],
      )
    ).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Unassigned');
    expect(rows[0].priority_order).toBe(0);
  });
});

describe('Unassigned project — list / DTO', () => {
  // Req 12.1/12.2: GET /api/projects returns Unassigned first with isDefault:true.
  it('GET /api/projects lists Unassigned first with isDefault:true; real projects isDefault:false', async () => {
    const { token } = await registerUser('u-list@example.com');
    const real = (await createProject(token, 'Work')).body.data;

    const list = await request(app).get('/api/projects').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.data[0].name).toBe('Unassigned');
    expect(list.body.data[0].isDefault).toBe(true);
    expect(list.body.data[0].priorityOrder).toBe(0);

    const realDto = list.body.data.find((p: { id: string }) => p.id === real.id);
    expect(realDto.isDefault).toBe(false);
  });
});

describe('Unassigned project — exclusive membership (Req 9)', () => {
  // Req 9.1: a task created with no projects lands in Unassigned only.
  it('links a no-project task to the Unassigned project only', async () => {
    const { token, userId } = await registerUser('u-excl-none@example.com');
    const def = await defaultProject(userId);

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'no project', priority: 'medium' });
    expect(created.status).toBe(201);

    expect(await membershipOf(created.body.data.id)).toEqual([def.id]);
  });

  // Req 9.2: a task created with a Real_Project is NOT in Unassigned.
  it('links a real-project task to the real project only (not Unassigned)', async () => {
    const { token, userId } = await registerUser('u-excl-real@example.com');
    const def = await defaultProject(userId);
    const real = (await createProject(token, 'Work')).body.data;

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'real project', priority: 'medium', projectIds: [real.id] });
    expect(created.status).toBe(201);

    const membership = await membershipOf(created.body.data.id);
    expect(membership).toEqual([real.id]);
    expect(membership).not.toContain(def.id);
  });

  // Req 9.3/9.4/9.6: membership transitions Unassigned <-> Real_Project, never both.
  it('moves membership between Unassigned and a real project on update (never both)', async () => {
    const { token, userId } = await registerUser('u-excl-update@example.com');
    const def = await defaultProject(userId);
    const real = (await createProject(token, 'Work')).body.data;

    // Start with no project → Unassigned only.
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'transitions', priority: 'medium' });
    const id = created.body.data.id as string;
    expect(await membershipOf(id)).toEqual([def.id]);

    // Assign the real project → Unassigned removed, real project only.
    const toReal = await request(app)
      .put(`/api/tasks/${id}`)
      .set(auth(token))
      .send({ projectIds: [real.id] });
    expect(toReal.status).toBe(200);
    expect(await membershipOf(id)).toEqual([real.id]);

    // Clear projects → back to Unassigned only.
    const toEmpty = await request(app)
      .put(`/api/tasks/${id}`)
      .set(auth(token))
      .send({ projectIds: [] });
    expect(toEmpty.status).toBe(200);
    expect(await membershipOf(id)).toEqual([def.id]);
  });
});

describe('Unassigned project — client cannot assign its id (Req 9.5)', () => {
  it('rejects the Unassigned id in projectIds on create and update with 400', async () => {
    const { token, userId } = await registerUser('u-client-id@example.com');
    const def = await defaultProject(userId);

    // Create with the Unassigned id → 400.
    const create = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'sneaky', priority: 'medium', projectIds: [def.id] });
    expect(create.status).toBe(400);

    // A legitimately-created task, then PUT with the Unassigned id → 400.
    const ok = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'legit', priority: 'medium' });
    const id = ok.body.data.id as string;

    const update = await request(app)
      .put(`/api/tasks/${id}`)
      .set(auth(token))
      .send({ projectIds: [def.id] });
    expect(update.status).toBe(400);
  });
});

describe('Unassigned project — protection (Req 10)', () => {
  it('rejects delete / rename / reorder-including-Unassigned with 400 and keeps it at order 0', async () => {
    const { token, userId } = await registerUser('u-protect@example.com');
    const def = await defaultProject(userId);
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;

    // Delete → 400, and the project still exists.
    const del = await request(app).delete(`/api/projects/${def.id}`).set(auth(token));
    expect(del.status).toBe(400);
    const stillThere = await pool.query<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM projects WHERE id = $1',
      [def.id],
    );
    expect(stillThere.rows[0].cnt).toBe('1');

    // Rename → 400.
    const rename = await request(app)
      .put(`/api/projects/${def.id}`)
      .set(auth(token))
      .send({ name: 'x' });
    expect(rename.status).toBe(400);

    // Reorder including the Unassigned id → 400.
    const badReorder = await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [def.id, a.id, b.id] });
    expect(badReorder.status).toBe(400);

    // A normal reorder of the real projects succeeds and leaves Unassigned at 0.
    const goodReorder = await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [b.id, a.id] });
    expect(goodReorder.status).toBe(200);
    expect(await defaultProject(userId)).toMatchObject({ priority_order: 0 });
  });
});

describe('Unassigned project — reserved name (Req 12.4)', () => {
  it('rejects creating or renaming to "Unassigned" (case-insensitive) with 409', async () => {
    const { token } = await registerUser('u-reserved@example.com');

    const exact = await createProject(token, 'Unassigned');
    expect(exact.status).toBe(409);

    const lower = await createProject(token, 'unassigned');
    expect(lower.status).toBe(409);

    const real = (await createProject(token, 'Work')).body.data;
    const rename = await request(app)
      .put(`/api/projects/${real.id}`)
      .set(auth(token))
      .send({ name: 'Unassigned' });
    expect(rename.status).toBe(409);
  });
});

describe('Unassigned project — 20-max counts real projects only (Req 11.1)', () => {
  it('allows 20 real projects despite the Unassigned project, and rejects the 21st', async () => {
    const { token } = await registerUser('u-max@example.com');

    for (let i = 1; i <= 20; i++) {
      const res = await createProject(token, `P${i}`);
      expect(res.status).toBe(201);
    }
    const overflow = await createProject(token, 'P21');
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Unassigned project — weight neutrality (Req 11.2/11.3/11.4)', () => {
  // With exactly one real project, projectMultiplier(order, totalProjects=1) is
  // 1.0, so a real-project task's subtotal is doubled while a task in only the
  // Unassigned project gets NO project contribution. Identical shape (same
  // priority, no due date) → the real-project task must outweigh the Unassigned
  // one, proving the Unassigned membership applies no multiplier.
  it('applies no project multiplier to an Unassigned-only task', async () => {
    const { token } = await registerUser('u-weight@example.com');
    const real = (await createProject(token, 'Work')).body.data;

    // Task A: in the real project. Task B: no project → Unassigned only.
    await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'task-A-real', priority: 'high', projectIds: [real.id] });
    await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'task-B-unassigned', priority: 'high' });

    const list = await request(app).get('/api/tasks').set(auth(token));
    expect(list.status).toBe(200);
    const byName = Object.fromEntries(
      list.body.data.map((t: { subject: string; weight: number }) => [t.subject, t.weight]),
    );

    // The real-project task is boosted (x2 at totalProjects=1); the
    // Unassigned-only task is not → strictly greater.
    expect(byName['task-A-real']).toBeGreaterThan(byName['task-B-unassigned']);
  });
});
