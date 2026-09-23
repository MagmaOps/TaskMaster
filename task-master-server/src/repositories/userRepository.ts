import { query, withTransaction } from '../database/pool';
import { DEFAULT_USER_SETTINGS, type OAuthAccountRow, type UserRow, type UserSettings } from '../types';
import { DEFAULT_TIMEZONE } from '../services/time/userTime';

/** Data access for users and their linked OAuth accounts. */

export async function findByEmail(email: string): Promise<UserRow | null> {
  const res = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return res.rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const res = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

export async function createPasswordUser(params: {
  email: string;
  passwordHash: string;
  displayName?: string | null;
  timezone?: string;
}): Promise<UserRow> {
  const res = await query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, settings)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      params.email.toLowerCase(),
      params.passwordHash,
      params.displayName ?? null,
      JSON.stringify({ ...DEFAULT_USER_SETTINGS, timezone: params.timezone ?? DEFAULT_TIMEZONE }),
    ],
  );
  return res.rows[0];
}

/** Overwrites a user's settings JSONB document and bumps updated_at. */
export async function updateSettings(userId: string, settings: UserSettings): Promise<UserRow> {
  const res = await query<UserRow>(
    `UPDATE users SET settings = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [userId, JSON.stringify(settings)],
  );
  return res.rows[0];
}

/** Updates a user's subscription tier and bumps updated_at. */
export async function updateTier(userId: string, tier: 'free' | 'premium'): Promise<UserRow> {
  const res = await query<UserRow>(
    `UPDATE users SET tier = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [userId, tier],
  );
  return res.rows[0];
}

export async function findOAuthAccount(
  provider: 'google',
  providerUserId: string,
): Promise<OAuthAccountRow | null> {
  const res = await query<OAuthAccountRow>(
    'SELECT * FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
    [provider, providerUserId],
  );
  return res.rows[0] ?? null;
}

export async function linkOAuthAccount(params: {
  userId: string;
  provider: 'google';
  providerUserId: string;
  email: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [params.userId, params.provider, params.providerUserId, params.email],
  );
}

/**
 * Creates a new user from a Google profile and links the OAuth account in one
 * transaction. Used when no existing user matches the Google identity or email.
 */
export async function createOAuthUser(params: {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  provider: 'google';
  providerUserId: string;
  timezone?: string;
}): Promise<UserRow> {
  return withTransaction(async (client) => {
    // A synthetic unique email is generated for accounts where Google withheld one.
    const email =
      params.email?.toLowerCase() ?? `google_${params.providerUserId}@users.noreply.taskmaster`;
    const userRes = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name, avatar_url, settings)
       VALUES ($1, NULL, $2, $3, $4)
       RETURNING *`,
      [
        email,
        params.displayName,
        params.avatarUrl,
        JSON.stringify({ ...DEFAULT_USER_SETTINGS, timezone: params.timezone ?? DEFAULT_TIMEZONE }),
      ],
    );
    const user = userRes.rows[0];
    await client.query(
      `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
       VALUES ($1, $2, $3, $4)`,
      [user.id, params.provider, params.providerUserId, params.email],
    );
    return user;
  });
}
