import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';
import { pool } from '../database/pool';
import { localCalendarDate, nextCalendarDate } from '../services/time/userTime';

/** Integration tests for task management against the ephemeral test DB. */
let app: Application;

beforeAll(() => {
  app = createApp();
});

/** Register a user and return an access token. */
async function registerUser(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'hunter2pass' });
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('task management', () => {
  it('creates a task and returns it with a weight', async () => {
    const token = await registerUser('a@example.com');
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'Write report', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe('Write report');
    expect(res.body.data.weight).toBeGreaterThan(0);
    expect(res.body.data.projects).toEqual([]);
  });

  it('lists tasks sorted by weight (highest first)', async () => {
    const token = await registerUser('b@example.com');
    await request(app).post('/api/tasks').set(auth(token)).send({ subject: 'low', priority: 'low' });
    await request(app).post('/api/tasks').set(auth(token)).send({ subject: 'high', priority: 'high' });
    const res = await request(app).get('/api/tasks').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].weight).toBeGreaterThanOrEqual(res.body.data[1].weight);
    expect(res.body.data[0].subject).toBe('high');
  });

  it('isolates tasks between users (404 on cross-user access)', async () => {
    const tokenA = await registerUser('owner@example.com');
    const tokenB = await registerUser('intruder@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tokenA))
      .send({ subject: 'secret', priority: 'medium' });
    const id = created.body.data.id as string;

    const listB = await request(app).get('/api/tasks').set(auth(tokenB));
    expect(listB.body.data).toHaveLength(0);

    const updateB = await request(app)
      .put(`/api/tasks/${id}`)
      .set(auth(tokenB))
      .send({ subject: 'hacked' });
    expect(updateB.status).toBe(404);
  });

  it('completes a task and rejects a second completion with 409', async () => {
    const token = await registerUser('c@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'done soon', priority: 'medium' });
    const id = created.body.data.id as string;

    const first = await request(app).put(`/api/tasks/${id}/complete`).set(auth(token));
    expect(first.status).toBe(200);
    expect(first.body.data.completedAt).toBeTruthy();
    expect(first.body.data.weightAtCompletion).toBeGreaterThan(0);

    const second = await request(app).put(`/api/tasks/${id}/complete`).set(auth(token));
    expect(second.status).toBe(409);
  });

  it('defers a task tomorrow and records a deferral (raising future weight)', async () => {
    const token = await registerUser('d@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'later', priority: 'low' });
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'tomorrow' });
    expect(res.status).toBe(200);
    expect(res.body.data.dueDate).toBeTruthy();
    expect(res.body.data.deferralCount).toBe(1);
  });

  it('sometime_later lowers priority and clears due date', async () => {
    const token = await registerUser('e@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'someday', priority: 'high', dueDate: '2026-12-01' });
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'sometime_later' });
    expect(res.body.data.priority).toBe('medium');
    expect(res.body.data.dueDate).toBeNull();
  });

  it('archives (soft-deletes) a task so it leaves the active list', async () => {
    const token = await registerUser('f@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'remove me', priority: 'medium' });
    const id = created.body.data.id as string;

    const del = await request(app).delete(`/api/tasks/${id}`).set(auth(token));
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/tasks').set(auth(token));
    expect(list.body.data).toHaveLength(0);
  });

  it('rejects invalid input with 400 VALIDATION_ERROR', async () => {
    const token = await registerUser('g@example.com');
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: '', priority: 'urgent' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('omits weightBreakdown for free users', async () => {
    const token = await registerUser('free@example.com');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'no breakdown', priority: 'high' });
    expect(created.body.data.weightBreakdown).toBeUndefined();
  });

  it('includes weightBreakdown for premium users with weight visibility enabled', async () => {
    const token = await registerUser('premium@example.com');
    // Promote the user to premium + enable weight visibility directly in the DB.
    await pool.query(
      `UPDATE users SET tier = 'premium',
         settings = jsonb_set(settings, '{weight_visibility_enabled}', 'true')
       WHERE email = $1`,
      ['premium@example.com'],
    );
    await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'with breakdown', priority: 'high' });
    const list = await request(app).get('/api/tasks').set(auth(token));
    expect(list.body.data[0].weightBreakdown).toBeDefined();
    expect(list.body.data[0].weightBreakdown.base).toBeGreaterThan(0);
  });
});

describe('task management — timezone', () => {
  /** Set a user's stored timezone directly in the DB after registration. */
  async function setTimezone(email: string, tz: string): Promise<void> {
    await pool.query(
      `UPDATE users SET settings = jsonb_set(settings, '{timezone}', $2::jsonb) WHERE email = $1`,
      [email, JSON.stringify(tz)],
    );
  }

  async function createTask(token: string, subject: string, priority = 'medium') {
    return request(app).post('/api/tasks').set(auth(token)).send({ subject, priority });
  }

  it('later_today sets dueDate to the user local calendar date in a non-UTC zone (Kiritimati, UTC+14)', async () => {
    // Req 6.1: later_today uses the user's local calendar day, resolved from
    // settings.timezone. Kiritimati (UTC+14) is a strong divergence case.
    const email = 'tz-later-kiritimati@example.com';
    const token = await registerUser(email);
    await setTimezone(email, 'Pacific/Kiritimati');

    const created = await createTask(token, 'defer later today');
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'later_today' });

    expect(res.status).toBe(200);
    // Recompute the expected local date in the same zone at (near) the same
    // instant; defer is deterministic w.r.t. the calendar date it produces.
    const expected = localCalendarDate('Pacific/Kiritimati');
    expect(res.body.data.dueDate).toBe(expected);
    // Sanity: this is the zone's local "today", not the server-local day.
    expect(res.body.data.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tomorrow sets dueDate to nextCalendarDate(local today) in a non-UTC zone and increments deferralCount', async () => {
    // Req 6.2: tomorrow = the calendar day after the user's local today.
    const email = 'tz-tomorrow-kiritimati@example.com';
    const token = await registerUser(email);
    await setTimezone(email, 'Pacific/Kiritimati');

    const created = await createTask(token, 'defer tomorrow');
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'tomorrow' });

    expect(res.status).toBe(200);
    const expected = nextCalendarDate(localCalendarDate('Pacific/Kiritimati'));
    expect(res.body.data.dueDate).toBe(expected);
    expect(res.body.data.deferralCount).toBe(1);
  });

  it('sometime_later downgrades priority one level and clears due date regardless of timezone', async () => {
    // Req 6.3: sometime_later is timezone-independent.
    const email = 'tz-sometime-kiritimati@example.com';
    const token = await registerUser(email);
    await setTimezone(email, 'Pacific/Kiritimati');

    const created = await request(app)
      .post('/api/tasks')
      .set(auth(token))
      .send({ subject: 'someday tz', priority: 'high', dueDate: '2026-12-01' });
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'sometime_later' });

    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe('medium');
    expect(res.body.data.dueDate).toBeNull();
  });

  it('unset timezone defaults to UTC: later_today equals localCalendarDate(UTC) (UTC fallback equivalence)', async () => {
    // Req 7.2 / 6.4: a freshly-registered user has timezone defaulting to
    // 'UTC', so the local calendar day equals the UTC calendar day.
    const email = 'tz-default-utc@example.com';
    const token = await registerUser(email);

    const created = await createTask(token, 'defer utc default');
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'later_today' });

    expect(res.status).toBe(200);
    expect(res.body.data.dueDate).toBe(localCalendarDate('UTC'));
  });

  it('explicit UTC timezone control: later_today equals localCalendarDate(UTC)', async () => {
    // Control alongside the Kiritimati cases: an explicit UTC user resolves the
    // same calendar day as the server-local day in the UTC test environment.
    const email = 'tz-explicit-utc@example.com';
    const token = await registerUser(email);
    await setTimezone(email, 'UTC');

    const created = await createTask(token, 'defer explicit utc');
    const id = created.body.data.id as string;

    const res = await request(app)
      .put(`/api/tasks/${id}/defer`)
      .set(auth(token))
      .send({ option: 'later_today' });

    expect(res.status).toBe(200);
    expect(res.body.data.dueDate).toBe(localCalendarDate('UTC'));
  });
});
