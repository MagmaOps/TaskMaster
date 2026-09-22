import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import type { AuthData, MeData, RefreshData, User } from '../api/types';

// Mock the auth API module the context depends on.
vi.mock('../api/auth', () => ({
  refresh: vi.fn(),
  me: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  google: vi.fn(),
  logout: vi.fn(),
}));
import * as authApi from '../api/auth';

const mockUser: User = {
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
};

function Probe() {
  const { status, user, loginWithPassword, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      <button onClick={() => loginWithPassword('a@b.com', 'password1').catch(() => {})}>
        login
      </button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

const renderApp = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthContext bootstrap', () => {
  it('becomes authenticated when refresh + me succeed', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: 'a' } as RefreshData);
    vi.mocked(authApi.me).mockResolvedValue({ user: mockUser } as MeData);

    renderApp();

    // Starts in loading, resolves to authenticated (no Login flash).
    expect(screen.getByTestId('status').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('user').textContent).toBe('a@b.com');
  });

  it('becomes unauthenticated when the silent refresh rejects', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('no cookie'));

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(authApi.me).not.toHaveBeenCalled();
    expect(screen.getByTestId('user').textContent).toBe('none');
  });
});

describe('AuthContext actions', () => {
  it('sets the user on successful password login', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('no session'));
    vi.mocked(authApi.login).mockResolvedValue({
      user: mockUser,
      accessToken: 'tok',
    } as AuthData);

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    await userEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('user').textContent).toBe('a@b.com');
  });

  it('clears session on logout even if the logout call rejects', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: 'a' } as RefreshData);
    vi.mocked(authApi.me).mockResolvedValue({ user: mockUser } as MeData);
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network'));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await userEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(screen.getByTestId('user').textContent).toBe('none');
  });
});

describe('useAuth guard', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within an AuthProvider/);
    spy.mockRestore();
  });
});
