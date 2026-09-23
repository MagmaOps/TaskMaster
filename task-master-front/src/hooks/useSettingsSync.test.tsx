import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider, useSettings } from '../contexts/SettingsContext';
import { useSettingsSync } from './useSettingsSync';
import type { User } from '../api/types';

// Mock the settings API and the auth context the hook depends on.
vi.mock('../api/settings', () => ({ updateSettings: vi.fn() }));
import * as settingsApi from '../api/settings';

const refreshProfile = vi.fn().mockResolvedValue(undefined);
let mockUser: User | null = null;
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshProfile }),
}));

function makeUser(theme: User['settings']['theme']): User {
  return {
    id: 'u1',
    email: 'a@b.com',
    displayName: 'Ada',
    avatarUrl: null,
    tier: 'free',
    currencyBalance: 0,
    settings: {
      project_priority_enabled: true,
      achievement_toasts_enabled: true,
      focus_mode_enabled: false,
      weight_visibility_enabled: false,
      theme,
      timezone: 'UTC',
    },
    isAdmin: false,
  };
}

function Probe() {
  const { theme } = useSettings();
  const { updateSetting } = useSettingsSync();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => updateSetting('focus_mode_enabled', true).catch(() => {})}>
        focus
      </button>
      <button onClick={() => updateSetting('theme', 'dark').catch(() => {})}>dark</button>
    </div>
  );
}

const renderHook = () =>
  render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = null;
  localStorage.clear();
  vi.mocked(settingsApi.updateSettings).mockResolvedValue(makeUser('dark'));
});

describe('useSettingsSync', () => {
  it('adopts the authenticated user server theme', async () => {
    mockUser = makeUser('dark');
    renderHook();
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
  });

  it('updateSetting PATCHes and refreshes the profile', async () => {
    mockUser = makeUser('system');
    renderHook();

    await userEvent.click(screen.getByText('focus'));

    await waitFor(() =>
      expect(settingsApi.updateSettings).toHaveBeenCalledWith({ focus_mode_enabled: true }),
    );
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('reverts the theme when the settings PATCH fails', async () => {
    mockUser = makeUser('light');
    vi.mocked(settingsApi.updateSettings).mockRejectedValueOnce(new Error('network'));
    renderHook();
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));

    await userEvent.click(screen.getByText('dark'));

    // Optimistically switched, then reverted after the rejection.
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));
    expect(refreshProfile).not.toHaveBeenCalled();
  });
});
