import { api, unwrap, normalizeError } from './client';
import type { SettingsPatch, User } from './types';

/**
 * Persist a partial settings update via PATCH /api/auth/me. The backend merges
 * the provided keys over the user's current settings (unspecified keys are
 * untouched) and returns the updated user. Premium-only keys sent by a
 * free-tier user are ignored server-side.
 */
export async function updateSettings(patch: SettingsPatch): Promise<User> {
  try {
    const res = await api.patch<{ success: true; data: { user: User } }>('/auth/me', patch);
    return unwrap(res).user;
  } catch (err) {
    throw normalizeError(err);
  }
}
