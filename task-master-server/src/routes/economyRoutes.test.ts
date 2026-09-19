import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import {
  clearCompletionListeners,
  registerCompletionListener,
} from '../services/completion/completionEvents';
import * as economyService from '../services/economy/economyService';

/**
 * Integration tests for the economy feature. To be deterministic regardless of
 * what other suites did to the global listener registry, this suite resets the
 * listeners to exactly the economy listener.
 */
let app: Application;

beforeAll(() => {
  app = createApp();
  clearCompletionListeners();
  registerCompletionListener(economyService.onTaskCompleted);
});

async function registerUser(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hunter2pass' });
  return res.body.data.accessToken as string;
}
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function createAndComplete(token: string, subject: string): Promise<number> {
  const created = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({ subject, priority: 'high' });
  const done = await request(app)
    .put(`/api/tasks/${created.body.data.id}/complete`)
    .set(auth(token));
  return done.body.data.weightAtCompletion as number;
}

describe('economy (integration)', () => {
  it('GET /api/economy requires auth', async () => {
    const res = await request(app).get('/api/economy');
    expect(res.status).toBe(401);
  });

  it('awards currency equal to weight for a free user', async () => {
    const token = await registerUser('eco1@example.com');
    const weight = await createAndComplete(token, 'earn me');
    const res = await request(app).get('/api/economy').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.earnRate).toBe(1);
    expect(res.body.data.tier).toBe('free');
    expect(res.body.data.balance).toBe(weight);
  });

  it('awards round(weight × 1.5) for a premium user', async () => {
    const token = await registerUser('eco2@example.com');
    await pool.query("UPDATE users SET tier = 'premium' WHERE email = $1", ['eco2@example.com']);
    const weight = await createAndComplete(token, 'premium earn');
    const res = await request(app).get('/api/economy').set(auth(token));
    expect(res.body.data.earnRate).toBe(1.5);
    expect(res.body.data.balance).toBe(Math.round(weight * 1.5));
  });

  it('accumulates across multiple completions and stays user-scoped', async () => {
    const token = await registerUser('eco3@example.com');
    const other = await registerUser('eco4@example.com');
    const w1 = await createAndComplete(token, 'a');
    const w2 = await createAndComplete(token, 'b');
    const res = await request(app).get('/api/economy').set(auth(token));
    expect(res.body.data.balance).toBe(w1 + w2);
    // The other user earned nothing.
    const otherRes = await request(app).get('/api/economy').set(auth(other));
    expect(otherRes.body.data.balance).toBe(0);
  });
});
