import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import type { AuthStatus } from './contexts/AuthContext';

// Control auth status per test. Login page and shell children are mocked to
// keep these tests focused on routing/guards.
let status: AuthStatus = 'loading';
vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({ status, user: null, logout: vi.fn() }),
}));

vi.mock('./pages/Login', () => ({
  default: () => <div>login page</div>,
}));

vi.mock('./components/layout/AppShell', () => ({
  AppShell: () => <div>app shell</div>,
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  status = 'loading';
});

describe('routing & protection', () => {
  it('shows a loading spinner (not Login) while auth is bootstrapping', () => {
    status = 'loading';
    renderAt('/');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('login page')).toBeNull();
  });

  it('redirects unauthenticated users from a protected route to /login', async () => {
    status = 'unauthenticated';
    renderAt('/');
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });

  it('renders the app shell for authenticated users on a protected route', async () => {
    status = 'authenticated';
    renderAt('/');
    await waitFor(() => expect(screen.getByText('app shell')).toBeInTheDocument());
  });

  it('redirects authenticated users away from /login to the shell', async () => {
    status = 'authenticated';
    renderAt('/login');
    await waitFor(() => expect(screen.getByText('app shell')).toBeInTheDocument());
    expect(screen.queryByText('login page')).toBeNull();
  });

  it('redirects unknown routes to /login when unauthenticated', async () => {
    status = 'unauthenticated';
    renderAt('/nonsense');
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });
});
