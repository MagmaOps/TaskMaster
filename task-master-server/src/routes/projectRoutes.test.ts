import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';

/** Integration tests for projects against the ephemeral test DB. */
let app: Application;

beforeAll(() => {
  app = createApp();
});

async function registerUser(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hunter2pass' });
  return res.body.data.accessToken as string;
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function createProject(token: string, name: string, color?: string) {
  return request(app).post('/api/projects').set(auth(token)).send({ name, color });
}

describe('projects management', () => {
  it('creates a project appended at the next priority order with taskCount 0', async () => {
    const token = await registerUser('p1@example.com');
    const a = await createProject(token, 'Work');
    const b = await createProject(token, 'Personal');
    expect(a.status).toBe(201);
    expect(a.body.data.priorityOrder).toBe(1);
    expect(a.body.data.taskCount).toBe(0);
    expect(b.body.data.priorityOrder).toBe(2);
  });

  it('lists projects ordered by priority with accurate active task counts', async () => {
    const token = await registerUser('p2@example.com');
    const proj = (await createProject(token, 'Work')).body.data;
    // Assign a task to the project → count 1.
    const task = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 't', priority: 'high', projectIds: [proj.id] });
    let list = await request(app).get('/api/projects').set(auth(token));
    const findProj = (data: { id: string; taskCount: number }[]) =>
      data.find((p) => p.id === proj.id) as { taskCount: number };
    expect(findProj(list.body.data).taskCount).toBe(1);
    // Complete the task → count 0 (only active tasks counted).
    await request(app).put(`/api/tasks/${task.body.data.id}/complete`).set(auth(token));
    list = await request(app).get('/api/projects').set(auth(token));
    expect(findProj(list.body.data).taskCount).toBe(0);
  });

  it('enforces the 20-project maximum', async () => {
    const token = await registerUser('p3@example.com');
    for (let i = 1; i <= 20; i++) {
      const res = await createProject(token, `P${i}`);
      expect(res.status).toBe(201);
    }
    const overflow = await createProject(token, 'P21');
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate names (case-insensitive) with 409', async () => {
    const token = await registerUser('p4@example.com');
    await createProject(token, 'Work');
    const dupe = await createProject(token, 'work');
    expect(dupe.status).toBe(409);
  });

  it('reorders projects and keeps orders contiguous', async () => {
    const token = await registerUser('p5@example.com');
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;
    const c = (await createProject(token, 'C')).body.data;

    const res = await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    const reordered = res.body.data.filter((p: { isDefault: boolean }) => !p.isDefault);
    expect(reordered.map((p: { name: string }) => p.name)).toEqual(['C', 'A', 'B']);
    expect(reordered.map((p: { priorityOrder: number }) => p.priorityOrder)).toEqual([1, 2, 3]);
  });

  it('rejects a reorder that is not the full set', async () => {
    const token = await registerUser('p6@example.com');
    const a = (await createProject(token, 'A')).body.data;
    await createProject(token, 'B');
    const res = await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [a.id] }); // missing B
    expect(res.status).toBe(400);
  });

  it('deletes a project, closes the gap, and keeps its tasks', async () => {
    const token = await registerUser('p7@example.com');
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;
    const c = (await createProject(token, 'C')).body.data;
    // Assign a task to B.
    const task = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'keep me', priority: 'medium', projectIds: [b.id] });

    const del = await request(app).delete(`/api/projects/${b.id}`).set(auth(token));
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/projects').set(auth(token));
    // A stays 1, C moves from 3 to 2 (gap closed).
    const byName = Object.fromEntries(
      list.body.data
        .filter((p: { isDefault: boolean }) => !p.isDefault)
        .map((p: { name: string; priorityOrder: number }) => [p.name, p.priorityOrder]),
    );
    expect(byName).toEqual({ A: 1, C: 2 });
    void a;
    void c;

    // The task still exists (just no longer associated with the deleted project).
    const tasks = await request(app).get('/api/tasks').set(auth(token));
    const found = tasks.body.data.find((t: { id: string }) => t.id === task.body.data.id);
    expect(found).toBeDefined();
    expect(found.projects).toEqual([]);
  });

  it('isolates projects between users (404 on cross-user update)', async () => {
    const tokenA = await registerUser('owner-p@example.com');
    const tokenB = await registerUser('intruder-p@example.com');
    const proj = (await createProject(tokenA, 'Private')).body.data;
    const res = await request(app)
      .put(`/api/projects/${proj.id}`)
      .set(auth(tokenB))
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('reordering affects task weight ordering (top project boosts its task)', async () => {
    const token = await registerUser('p8@example.com');
    const a = (await createProject(token, 'A')).body.data;
    const b = (await createProject(token, 'B')).body.data;
    // Two identical tasks, one per project.
    await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'task-A', priority: 'medium', projectIds: [a.id] });
    await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'task-B', priority: 'medium', projectIds: [b.id] });

    // With A on top, task-A should outweigh task-B.
    let tasks = await request(app).get('/api/tasks').set(auth(token));
    expect(tasks.body.data[0].subject).toBe('task-A');

    // Move B to the top.
    await request(app)
      .put('/api/projects/reorder')
      .set(auth(token))
      .send({ projectIds: [b.id, a.id] });
    tasks = await request(app).get('/api/tasks').set(auth(token));
    expect(tasks.body.data[0].subject).toBe('task-B');
  });
});
