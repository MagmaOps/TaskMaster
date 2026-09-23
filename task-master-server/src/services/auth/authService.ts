import * as userRepo from '../../repositories/userRepository';
import * as refreshRepo from '../../repositories/refreshTokenRepository';
import * as projectRepo from '../../repositories/projectRepository';
import { ApiError } from '../../utils/errors';
import { toPublicUser, type PublicUser, type UserRow, type UserSettings } from '../../types';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from './tokenService';
import { hashPassword, validatePasswordStrength, verifyPassword } from './passwordService';
import { verifyGoogleIdToken } from './googleVerifier';
import { resolveTimezone } from '../../services/time/userTime';

/** Orchestrates registration, login, Google sign-in, and session refresh. */

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Raw refresh token to set as an httpOnly cookie (never stored raw server-side). */
  refreshToken: string;
  isNewUser?: boolean;
}

async function issueTokens(user: UserRow, userAgent?: string | null): Promise<AuthResult> {
  const accessToken = signAccessToken(user.id);
  const { raw, hash } = generateRefreshToken();
  await refreshRepo.create({
    userId: user.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiry(),
    userAgent: userAgent ?? null,
  });
  return { user: toPublicUser(user), accessToken, refreshToken: raw };
}

export async function register(params: {
  email: string;
  password: string;
  displayName?: string | null;
  userAgent?: string | null;
  timezone?: unknown;
}): Promise<AuthResult> {
  const weakness = validatePasswordStrength(params.password);
  if (weakness) {
    throw ApiError.badRequest('WEAK_PASSWORD', weakness);
  }

  const existing = await userRepo.findByEmail(params.email);
  if (existing) {
    throw ApiError.badRequest('EMAIL_EXISTS', 'Email already exists');
  }

  const passwordHash = await hashPassword(params.password);
  const user = await userRepo.createPasswordUser({
    email: params.email,
    passwordHash,
    displayName: params.displayName ?? null,
    timezone: resolveTimezone(params.timezone),
  });
  await projectRepo.ensureDefault(user.id);
  return issueTokens(user, params.userAgent);
}

export async function login(params: {
  email: string;
  password: string;
  userAgent?: string | null;
}): Promise<AuthResult> {
  const user = await userRepo.findByEmail(params.email);
  // Same generic error whether the user is missing or has no password (Google-only).
  if (!user || !user.password_hash) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const ok = await verifyPassword(params.password, user.password_hash);
  if (!ok) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return issueTokens(user, params.userAgent);
}

export async function loginWithGoogle(params: {
  idToken: string;
  userAgent?: string | null;
  timezone?: unknown;
}): Promise<AuthResult> {
  const profile = await verifyGoogleIdToken(params.idToken);

  // 1. Existing linked Google account -> sign in.
  const oauth = await userRepo.findOAuthAccount('google', profile.sub);
  if (oauth) {
    const user = await userRepo.findById(oauth.user_id);
    if (!user) {
      throw ApiError.unauthorized('GOOGLE_VERIFY_FAILED', 'Linked account not found');
    }
    return issueTokens(user, params.userAgent);
  }

  // 2. No linked account, but a verified email matches an existing user -> link.
  if (profile.email && profile.emailVerified) {
    const existing = await userRepo.findByEmail(profile.email);
    if (existing) {
      await userRepo.linkOAuthAccount({
        userId: existing.id,
        provider: 'google',
        providerUserId: profile.sub,
        email: profile.email,
      });
      return { ...(await issueTokens(existing, params.userAgent)), isNewUser: false };
    }
  }

  // 3. Otherwise create a brand new user + linked account.
  const created = await userRepo.createOAuthUser({
    email: profile.email,
    displayName: profile.name,
    avatarUrl: profile.picture,
    provider: 'google',
    providerUserId: profile.sub,
    timezone: resolveTimezone(params.timezone),
  });
  await projectRepo.ensureDefault(created.id);
  return { ...(await issueTokens(created, params.userAgent)), isNewUser: true };
}

/** Rotates the refresh token: revokes the presented one and issues a fresh pair. */
export async function refresh(params: {
  rawRefreshToken: string;
  userAgent?: string | null;
}): Promise<AuthResult> {
  const hash = hashRefreshToken(params.rawRefreshToken);
  const row = await refreshRepo.findValidByHash(hash);
  if (!row) {
    throw ApiError.unauthorized('TOKEN_INVALID', 'Refresh token is invalid or expired');
  }
  const user = await userRepo.findById(row.user_id);
  if (!user) {
    throw ApiError.unauthorized('TOKEN_INVALID', 'Refresh token is invalid or expired');
  }
  await refreshRepo.revoke(row.id);
  return issueTokens(user, params.userAgent);
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  await refreshRepo.revokeByHash(hashRefreshToken(rawRefreshToken));
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return toPublicUser(user);
}

/**
 * A partial settings update: any subset of the user-editable settings keys.
 * The route validator has already type-checked each present key.
 */
export type SettingsPatch = Partial<{
  theme: UserSettings['theme'];
  focus_mode_enabled: boolean;
  achievement_toasts_enabled: boolean;
  project_priority_enabled: boolean;
  weight_visibility_enabled: boolean;
  timezone: unknown;
  /**
   * Subscription tier. Admin-only: applied only when the requesting user has
   * `is_admin` (a developer affordance for testing premium features). Ignored
   * for non-admins — the client cannot self-promote.
   */
  tier: 'free' | 'premium';
}>;

/**
 * Merges a partial settings patch into the user's settings JSONB, preserving
 * every unspecified key. `timezone` is resolved defensively (invalid → 'UTC')
 * even though the route validator already rejects invalid values.
 *
 * Tier guard (defense in depth): `weight_visibility_enabled` is a premium-only
 * preference, so it is dropped from the patch for non-premium users regardless
 * of what the client sends; the UI also hides the control.
 */
export async function updateSettings(userId: string, patch: SettingsPatch): Promise<PublicUser> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  // Admin-only tier change (developer affordance). Applied first so a same-
  // request weight-visibility change sees the new tier. Silently ignored for
  // non-admins — the client cannot grant itself premium.
  let effectiveTier = user.tier;
  if (patch.tier !== undefined && user.is_admin) {
    if (patch.tier !== user.tier) {
      const bumped = await userRepo.updateTier(userId, patch.tier);
      effectiveTier = bumped.tier;
    }
  }

  const next: UserSettings = { ...user.settings };
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.focus_mode_enabled !== undefined) next.focus_mode_enabled = patch.focus_mode_enabled;
  if (patch.achievement_toasts_enabled !== undefined) {
    next.achievement_toasts_enabled = patch.achievement_toasts_enabled;
  }
  if (patch.project_priority_enabled !== undefined) {
    next.project_priority_enabled = patch.project_priority_enabled;
  }
  // Premium-only: ignore for non-premium users (uses the possibly-just-updated tier).
  if (patch.weight_visibility_enabled !== undefined && effectiveTier === 'premium') {
    next.weight_visibility_enabled = patch.weight_visibility_enabled;
  }
  if (patch.timezone !== undefined) next.timezone = resolveTimezone(patch.timezone);

  const updated = await userRepo.updateSettings(userId, next);
  return toPublicUser(updated);
}
