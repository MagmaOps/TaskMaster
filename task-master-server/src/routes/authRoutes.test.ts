import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../app';

/**
 * Integration tests: real Express app against the ephemeral test Postgres.
 * Google happy-path is covered separately at the service layer with a mocked
 * verifier (real Google tokens are unavailable here).
 */
let app: Application;

beforeAll(() => {
  app = createApp();
});

const creds = { email: 'test@example.com', password: 'hunter2pass' };

describe('auth routes', () => {
  it('registers a new user and returns an access token', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user).not.toHaveProperty('password_hash');
    expect(res.headers['set-cookie']?.[0]).toMatch(/tm_refresh/);
  });

  it('rejects duplicate email with 400 EMAIL_EXISTS', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('rejects weak password with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@example.com', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in and accesses /me with the token', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const login = await request(app).post('/api/auth/login').send(creds);
    expect(login.status).toBe(200);

    const token = login.body.data.accessToken as string;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('test@example.com');
  });

  it('returns generic 401 on wrong password', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'wrongpass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REQUIRED');
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const login = await request(app).post('/api/auth/login').send(creds);
    const oldCookie = login.headers['set-cookie'];

    const refresh1 = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.data.accessToken).toBeTruthy();

    // Reusing the original (now-revoked) cookie must fail.
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_INVALID');
  });

  it('logout revokes the refresh token', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const login = await request(app).post('/api/auth/login').send(creds);
    const cookie = login.headers['set-cookie'];

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('returns 503 for Google sign-in when GOOGLE_CLIENT_ID is unset', async () => {
    const res = await request(app).post('/api/auth/google').send({ idToken: 'anything' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GOOGLE_NOT_CONFIGURED');
  });
});
