import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { ApiError } from '../../utils/errors';

/**
 * JWT access tokens + opaque refresh tokens.
 * Access tokens are short-lived and signed with JWT_ACCESS_SECRET.
 * Refresh tokens are random strings; only their SHA-256 hash is persisted.
 */

interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } as AccessTokenPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): { userId: string } {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
    if (!decoded.sub) throw new Error('missing sub');
    return { userId: decoded.sub };
  } catch {
    throw ApiError.unauthorized('TOKEN_INVALID', 'Access token is invalid or expired');
  }
}

/** Generate a new refresh token: returns the raw value (for the client) and its hash (for storage). */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(48).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Refresh token expiry as an absolute Date, based on configured TTL days. */
export function refreshTokenExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + config.jwt.refreshTtlDays);
  return d;
}
