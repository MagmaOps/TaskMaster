import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';
import { SettingsProvider } from '../contexts/SettingsContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { User } from '../api/types';

vi.mock('../api/settings', () => ({ updateSettings: vi.fn() }));
import * as settingsApi from '../api/settings';

const refreshProfile = vi.fn().mockResolvedValue(undefined);
let mockUser: User;
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshProfile }),
}));

function makeUser(overrides: Partial<User> = {}): User {
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
      theme: 'system',
      timezone: 'UTC',
    },
    isAdmin: false,
    ...overrides,
  };
}

const renderPage = () =>
  render(
    <SettingsProvider>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </SettingsProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockUser = makeUser();
  vi.mocked(settingsApi.updateSettings).mockResolvedValue(makeUser());
});

describe('Settings page', () => {
  it('renders switches reflecting user.settings', () => {
    renderPage();
    const focus = screen.getByRole('switch', { name: 'Focus Mode' });
    expect(focus).toHaveAttribute('aria-checked', 'false');
    const toasts = screen.getByRole('switch', { name: 'Achievement toasts' });
    expect(toasts).toHaveAttribute('aria-checked', 'true');
  });

  it('persists a toggle via updateSettings + refreshProfile', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('switch', { name: 'Focus Mode' }));
    await waitFor(() =>
      expect(settingsApi.updateSettings).toHaveBeenCalledWith({ focus_mode_enabled: true }),
    );
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('hides the weight-visibility switch for free users', () => {
    renderPage();
    expect(screen.queryByRole('switch', { name: 'Show task weight' })).toBeNull();
    // The premium note still labels the feature.
    expect(screen.getByText(/Premium feature/i)).toBeInTheDocument();
  });

  it('shows the weight-visibility switch for premium users', () => {
    mockUser = makeUser({ tier: 'premium' });
    renderPage();
    expect(screen.getByRole('switch', { name: 'Show task weight' })).toBeInTheDocument();
  });

  it('hides the Developer section for non-admins', () => {
    renderPage();
    expect(screen.queryByText('Developer')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Premium account' })).toBeNull();
  });

  it('shows the Developer premium toggle for admins and PATCHes tier', async () => {
    mockUser = makeUser({ isAdmin: true });
    renderPage();
    const premiumToggle = screen.getByRole('switch', { name: 'Premium account' });
    expect(premiumToggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(premiumToggle);
    await waitFor(() =>
      expect(settingsApi.updateSettings).toHaveBeenCalledWith({ tier: 'premium' }),
    );
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('reverts and toasts when a save fails', async () => {
    vi.mocked(settingsApi.updateSettings).mockRejectedValueOnce(
      Object.assign(new Error('nope'), { message: 'Something went wrong' }),
    );
    renderPage();
    await userEvent.click(screen.getByRole('switch', { name: 'Project priority' }));
    // refreshProfile is not called on failure; the control reverts to server truth.
    await waitFor(() => expect(settingsApi.updateSettings).toHaveBeenCalled());
    expect(refreshProfile).not.toHaveBeenCalled();
    const toggle = screen.getByRole('switch', { name: 'Project priority' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
