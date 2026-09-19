import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from './tokenService';
import { ApiError } from '../../utils/errors';

describe('tokenService', () => {
  it('signs an access token that verifies back to the same userId', () => {
    const token = signAccessToken('user-123');
    expect(verifyAccessToken(token)).toEqual({ userId: 'user-123' });
  });

  it('rejects a tampered/invalid access token', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow(ApiError);
  });

  it('generates a refresh token whose hash matches hashRefreshToken', () => {
    const { raw, hash } = generateRefreshToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hash).toBe(hashRefreshToken(raw));
    expect(hash).not.toBe(raw);
  });

  it('computes a refresh expiry in the future', () => {
    expect(refreshTokenExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});
