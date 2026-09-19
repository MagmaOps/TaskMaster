import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../../app';
import { pool } from '../../database/pool';
import {
  registerCompletionListener,
  clearCompletionListeners,
  type CompletionEvent,
} from './completionEvents';

/**
 * Integration tests for the completion-event refactor: the dispatcher fires on
 * real completions, weight_at_completion is persisted, repeatable tasks get a
 * standalone series id, and a failing listener never breaks completion.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
});
beforeEach(() => clearCompletionListeners());
afterEach(() => clearCompletionListeners());

async function registerUser(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hunter2pass' });
  return res.body.data.accessToken as string;
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('completion events (integration)', () => {
  it('fires listeners with the event and a positive weight, and returns unlocked', async () => {
    const token = await registerUser('ce1@example.com');
    let received: CompletionEvent | null = null;
    registerCompletionListener(async (e) => {
      received = e;
      e.unlocked.push({ type: 'demo' });
    });

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'ship it', priority: 'high' });
    const done = await request(app)
      .put(`/api/tasks/${created.body.data.id}/complete`)
      .set(auth(token));

    expect(done.status).toBe(200);
    expect(received).not.toBeNull();
    expect((received as unknown as CompletionEvent).weightAtCompletion).toBeGreaterThan(0);
    expect(done.body.data.unlocked).toEqual([{ type: 'demo' }]);
  });

  it('persists weight_at_completion on the task row', async () => {
    const token = await registerUser('ce2@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'record weight', priority: 'medium' });
    await request(app).put(`/api/tasks/${created.body.data.id}/complete`).set(auth(token));

    const row = await pool.query(
      'SELECT weight_at_completion FROM tasks WHERE id = $1',
      [created.body.data.id],
    );
    expect(row.rows[0].weight_at_completion).toBeGreaterThan(0);
  });

  it('never fails completion when a listener throws', async () => {
    const token = await registerUser('ce3@example.com');
    registerCompletionListener(async () => {
      throw new Error('listener blew up');
    });
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'resilient', priority: 'low' });
    const done = await request(app)
      .put(`/api/tasks/${created.body.data.id}/complete`)
      .set(auth(token));
    expect(done.status).toBe(200);
  });

  it('creating a repeatable task assigns a standalone repeat_series_id (not the task id)', async () => {
    const token = await registerUser('ce4@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({
        subject: 'daily standup',
        priority: 'medium',
        isRepeatable: true,
        repeatPattern: { frequency: 'daily', interval: 1 },
      });
    const row = await pool.query(
      'SELECT id, repeat_series_id FROM tasks WHERE id = $1',
      [created.body.data.id],
    );
    expect(row.rows[0].repeat_series_id).toBeTruthy();
    expect(row.rows[0].repeat_series_id).not.toBe(row.rows[0].id);
  });

  it('non-repeatable task has null repeat_series_id', async () => {
    const token = await registerUser('ce5@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'one-off', priority: 'low' });
    const row = await pool.query('SELECT repeat_series_id FROM tasks WHERE id = $1', [
      created.body.data.id,
    ]);
    expect(row.rows[0].repeat_series_id).toBeNull();
  });
});
