/**
 * Unit tests for the Google sign-in decision logic (find / link / create),
 * with repositories and the Google verifier mocked. No database involved.
 */
import * as userRepo from '../../repositories/userRepository';
import * as refreshRepo from '../../repositories/refreshTokenRepository';
import * as googleVerifier from './googleVerifier';
import { loginWithGoogle } from './authService';
import type { UserRow } from '../../types';

jest.mock('../../repositories/userRepository');
jest.mock('../../repositories/refreshTokenRepository');
jest.mock('./googleVerifier');

const mockedUserRepo = jest.mocked(userRepo);
const mockedRefreshRepo = jest.mocked(refreshRepo);
const mockedVerifier = jest.mocked(googleVerifier);

function fakeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    email: 'g@example.com',
    password_hash: null,
    display_name: 'G User',
    avatar_url: null,
    tier: 'free',
    currency_balance: '0',
    settings: {
      project_priority_enabled: true,
      achievement_toasts_enabled: true,
      focus_mode_enabled: false,
      weight_visibility_enabled: false,
      theme: 'system',
      timezone: 'UTC',
    },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockedRefreshRepo.create.mockResolvedValue({} as never);
  mockedVerifier.verifyGoogleIdToken.mockResolvedValue({
    sub: 'google-sub-1',
    email: 'g@example.com',
    emailVerified: true,
    name: 'G User',
    picture: 'http://pic',
  });
});

it('signs in an existing linked google account (no create/link)', async () => {
  mockedUserRepo.findOAuthAccount.mockResolvedValue({ user_id: 'user-1' } as never);
  mockedUserRepo.findById.mockResolvedValue(fakeUser());

  const res = await loginWithGoogle({ idToken: 'x' });

  expect(res.user.id).toBe('user-1');
  expect(res.isNewUser).toBeUndefined();
  expect(mockedUserRepo.createOAuthUser).not.toHaveBeenCalled();
  expect(mockedUserRepo.linkOAuthAccount).not.toHaveBeenCalled();
});

it('links google to an existing user matched by verified email', async () => {
  mockedUserRepo.findOAuthAccount.mockResolvedValue(null);
  mockedUserRepo.findByEmail.mockResolvedValue(fakeUser({ id: 'user-2' }));

  const res = await loginWithGoogle({ idToken: 'x' });

  expect(res.user.id).toBe('user-2');
  expect(res.isNewUser).toBe(false);
  expect(mockedUserRepo.linkOAuthAccount).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'user-2', provider: 'google', providerUserId: 'google-sub-1' }),
  );
});

it('creates a new user when no account and no matching email', async () => {
  mockedUserRepo.findOAuthAccount.mockResolvedValue(null);
  mockedUserRepo.findByEmail.mockResolvedValue(null);
  mockedUserRepo.createOAuthUser.mockResolvedValue(fakeUser({ id: 'user-new' }));

  const res = await loginWithGoogle({ idToken: 'x' });

  expect(res.user.id).toBe('user-new');
  expect(res.isNewUser).toBe(true);
  expect(mockedUserRepo.createOAuthUser).toHaveBeenCalled();
});
