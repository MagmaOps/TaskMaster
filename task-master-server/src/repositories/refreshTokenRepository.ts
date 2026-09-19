import { query } from '../database/pool';
import type { RefreshTokenRow } from '../types';

/** Data access for revocable, rotating refresh tokens. */

export async function create(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
}): Promise<RefreshTokenRow> {
  const res = await query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.userId, params.tokenHash, params.expiresAt, params.userAgent ?? null],
  );
  return res.rows[0];
}

/** Returns a token row only if it exists, is not revoked, and has not expired. */
export async function findValidByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
  const res = await query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash],
  );
  return res.rows[0] ?? null;
}

export async function revoke(id: string): Promise<void> {
  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [
    id,
  ]);
}

export async function revokeByHash(tokenHash: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash],
  );
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}
