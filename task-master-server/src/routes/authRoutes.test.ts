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

/**
 * Timezone integration tests (feature: user-timezone).
 * Covers the PATCH /api/auth/me update contract, timezone at registration,
 * and read-time coalescing for legacy rows missing the timezone key.
 * Appended as a separate describe block; existing tests above are untouched.
 * Unique emails per test avoid collisions with the shared truncating test DB.
 */
import { pool } from '../database/pool';

describe('auth routes — timezone', () => {
  it('PATCH /api/auth/me with a valid zone updates timezone and preserves other settings', async () => {
    const email = 'tz-valid@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.status).toBe(201);

    // Defaults after registration (no timezone supplied → 'UTC').
    const defaults = reg.body.data.user.settings;
    expect(defaults.timezone).toBe('UTC');
    expect(defaults.theme).toBe('system');
    expect(defaults.project_priority_enabled).toBe(true);

    const token = reg.body.data.accessToken as string;
    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: 'Asia/Tokyo' });

    expect(patch.status).toBe(200);
    const settings = patch.body.data.user.settings;
    expect(settings.timezone).toBe('Asia/Tokyo');
    // Only the timezone key changed; every other setting matches the defaults.
    expect(settings.theme).toBe(defaults.theme);
    expect(settings.project_priority_enabled).toBe(defaults.project_priority_enabled);
    expect(settings.achievement_toasts_enabled).toBe(defaults.achievement_toasts_enabled);
    expect(settings.focus_mode_enabled).toBe(defaults.focus_mode_enabled);
    expect(settings.weight_visibility_enabled).toBe(defaults.weight_visibility_enabled);
  });

  it('PATCH /api/auth/me with an invalid zone returns 400 and leaves the stored value unchanged', async () => {
    const email = 'tz-invalid@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.accessToken as string;

    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ timezone: 'Not/AZone' });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('VALIDATION_ERROR');

    // The rejected write must not have mutated settings: still the register default 'UTC'.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.settings.timezone).toBe('UTC');
  });

  it('PATCH /api/auth/me without a token returns 401', async () => {
    const res = await request(app).patch('/api/auth/me').send({ timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it('POST /register with a valid timezone stores it', async () => {
    const email = 'tz-register-valid@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass', timezone: 'America/New_York' });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.settings.timezone).toBe('America/New_York');

    const token = reg.body.data.accessToken as string;
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.body.data.user.settings.timezone).toBe('America/New_York');
  });

  it('POST /register without a timezone defaults to UTC', async () => {
    const email = 'tz-register-none@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.settings.timezone).toBe('UTC');
  });

  it('POST /register with a garbage timezone still succeeds and falls back to UTC', async () => {
    const email = 'tz-register-garbage@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass', timezone: 'Mars/Phobos' });
    // Register never 400s on the timezone field; invalid values silently fall back.
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.settings.timezone).toBe('UTC');
  });

  it('GET /me reports UTC for a legacy row whose settings lack the timezone key', async () => {
    const email = 'tz-legacy@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass', timezone: 'Asia/Tokyo' });
    expect(reg.status).toBe(201);
    const token = reg.body.data.accessToken as string;

    // Simulate a pre-feature row by stripping the timezone key from the JSONB.
    await pool.query(`UPDATE users SET settings = settings - 'timezone' WHERE email = $1`, [email]);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    // Read-time coalescing in toPublicUser fills the missing key with 'UTC'.
    expect(me.body.data.user.settings.timezone).toBe('UTC');
  });
});

/**
 * Settings PATCH integration tests (feature: frontend-profile-settings backend
 * change). Covers the widened PATCH /api/auth/me partial-settings contract:
 * boolean/theme keys persist and merge, validation rejects bad values, and the
 * premium-only weight_visibility_enabled key is stripped for non-premium users.
 * The timezone-only backward-compat path is covered by the timezone block above.
 */
describe('auth routes — settings patch', () => {
  it('PATCH /api/auth/me persists a partial settings update and preserves other keys', async () => {
    const email = 'settings-partial@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.status).toBe(201);
    const defaults = reg.body.data.user.settings;
    expect(defaults.theme).toBe('system');
    expect(defaults.focus_mode_enabled).toBe(false);
    expect(defaults.achievement_toasts_enabled).toBe(true);

    const token = reg.body.data.accessToken as string;
    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark', focus_mode_enabled: true });

    expect(patch.status).toBe(200);
    const settings = patch.body.data.user.settings;
    // Changed keys applied.
    expect(settings.theme).toBe('dark');
    expect(settings.focus_mode_enabled).toBe(true);
    // Unspecified keys untouched.
    expect(settings.achievement_toasts_enabled).toBe(defaults.achievement_toasts_enabled);
    expect(settings.project_priority_enabled).toBe(defaults.project_priority_enabled);
    expect(settings.timezone).toBe(defaults.timezone);
  });

  it('PATCH /api/auth/me rejects an invalid theme with 400 and leaves settings unchanged', async () => {
    const email = 'settings-bad-theme@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    const token = reg.body.data.accessToken as string;

    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'neon' });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('VALIDATION_ERROR');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.body.data.user.settings.theme).toBe('system');
  });

  it('PATCH /api/auth/me ignores weight_visibility_enabled for a free-tier user', async () => {
    const email = 'settings-free-weight@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.body.data.user.tier).toBe('free');
    const token = reg.body.data.accessToken as string;

    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ weight_visibility_enabled: true });
    // Request is well-formed (200) but the premium-only key is stripped server-side.
    expect(patch.status).toBe(200);
    expect(patch.body.data.user.settings.weight_visibility_enabled).toBe(false);
  });

  it('PATCH /api/auth/me applies weight_visibility_enabled for a premium user', async () => {
    const email = 'settings-premium-weight@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    const token = reg.body.data.accessToken as string;
    // Promote to premium directly (no self-serve upgrade path in the API).
    await pool.query(`UPDATE users SET tier = 'premium' WHERE email = $1`, [email]);

    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ weight_visibility_enabled: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data.user.tier).toBe('premium');
    expect(patch.body.data.user.settings.weight_visibility_enabled).toBe(true);
  });
});

/**
 * Admin tier self-toggle (developer affordance). A user with `is_admin` may
 * change their own tier via PATCH /api/auth/me; a normal user cannot. This is
 * the privilege-escalation boundary — the client must never be able to grant
 * itself premium.
 */
describe('auth routes — admin tier toggle', () => {
  it('ignores a tier change from a non-admin user', async () => {
    const email = 'tier-nonadmin@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    expect(reg.body.data.user.tier).toBe('free');
    expect(reg.body.data.user.isAdmin).toBe(false);
    const token = reg.body.data.accessToken as string;

    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'premium' });
    // Well-formed request (200) but the tier change is silently ignored.
    expect(patch.status).toBe(200);
    expect(patch.body.data.user.tier).toBe('free');
  });

  it('applies a tier change for an admin user and unlocks premium settings', async () => {
    const email = 'tier-admin@example.com';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'hunter2pass' });
    const token = reg.body.data.accessToken as string;
    // Grant admin out-of-band (as the operator would).
    await pool.query(`UPDATE users SET is_admin = true WHERE email = $1`, [email]);

    // Promote to premium and enable weight visibility in one request.
    const patch = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'premium', weight_visibility_enabled: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data.user.tier).toBe('premium');
    expect(patch.body.data.user.isAdmin).toBe(true);
    // The same-request weight-visibility change sees the new premium tier.
    expect(patch.body.data.user.settings.weight_visibility_enabled).toBe(true);

    // And can toggle back to free.
    const back = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'free' });
    expect(back.body.data.user.tier).toBe('free');
  });
});
