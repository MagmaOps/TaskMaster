import { useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import * as settingsApi from '../api/settings';
import type { SettingsPatch, ThemePreference } from '../api/types';

/**
 * Authenticated-scoped bridge between the server-owned `user.settings` and the
 * top-level `SettingsContext` (which sits above `AuthProvider` and therefore
 * cannot read the user itself — see the profile-settings design, Option A).
 *
 * Responsibilities:
 * - Adopt the authenticated user's stored theme into `SettingsContext` so the
 *   preference is cross-device (SettingsContext still owns the localStorage
 *   anti-flash seed for the pre-auth paint).
 * - Provide `updateSetting`, which persists a single preference via the partial
 *   PATCH and refreshes the auth profile so every consumer sees the new value.
 *
 * Must be used below both `AuthProvider` and `SettingsProvider` (e.g. inside the
 * authenticated `AppShell`).
 */
export function useSettingsSync() {
  const { user, refreshProfile } = useAuth();
  const { theme, setTheme } = useSettings();

  // Adopt the server theme for authenticated users (server wins). setTheme
  // mirrors to localStorage, so the next pre-paint uses the adopted value.
  const serverTheme = user?.settings.theme;
  useEffect(() => {
    if (serverTheme && serverTheme !== theme) {
      setTheme(serverTheme);
    }
    // Only react to the server value changing; `theme` is intentionally omitted
    // so a later local toggle isn't immediately overwritten within a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTheme, setTheme]);

  /**
   * Persist one preference. For `theme`, applies locally first for snappiness,
   * then reverts on failure. Always refreshes the profile on success so
   * `user.settings` (the source of truth) reflects the change.
   */
  const updateSetting = useCallback(
    async <K extends keyof SettingsPatch>(key: K, value: SettingsPatch[K]): Promise<void> => {
      const prevTheme = theme;
      if (key === 'theme') {
        setTheme(value as ThemePreference);
      }
      try {
        await settingsApi.updateSettings({ [key]: value } as SettingsPatch);
        await refreshProfile();
      } catch (err) {
        if (key === 'theme') {
          setTheme(prevTheme);
        }
        throw err;
      }
    },
    [theme, setTheme, refreshProfile],
  );

  return { updateSetting };
}
