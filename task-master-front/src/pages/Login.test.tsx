import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Login from './Login';
import { ApiError } from '../api/types';

// --- mocks ---
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const loginWithPassword = vi.fn();
const registerWithPassword = vi.fn();
const loginWithGoogle = vi.fn();
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ loginWithPassword, registerWithPassword, loginWithGoogle }),
}));

let googleAvailable = false;
const googleSignIn = vi.fn();
vi.mock('../hooks/useGoogleSignIn', () => ({
  useGoogleSignIn: () => ({ available: googleAvailable, signIn: googleSignIn }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  googleAvailable = false;
});

describe('Login page', () => {
  it('hides the Google button when Google is not configured', () => {
    googleAvailable = false;
    render(<Login />);
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });

  it('shows the Google button when configured', () => {
    googleAvailable = true;
    render(<Login />);
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('blocks submit and shows validation errors for bad email / short password', async () => {
    render(<Login />);
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(loginWithPassword).not.toHaveBeenCalled();
  });

  it('requires a display name in register mode', async () => {
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /create one/i }));

    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password1');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/display name is required/i)).toBeInTheDocument();
    expect(registerWithPassword).not.toHaveBeenCalled();
  });

  it('logs in and navigates on success', async () => {
    loginWithPassword.mockResolvedValue(undefined);
    render(<Login />);

    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(loginWithPassword).toHaveBeenCalledWith('a@b.com', 'password1'));
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('shows a friendly error on invalid credentials', async () => {
    loginWithPassword.mockRejectedValue(
      new ApiError('INVALID_CREDENTIALS', 'nope', 401),
    );
    render(<Login />);

    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('registers with the required display name and navigates', async () => {
    registerWithPassword.mockResolvedValue(undefined);
    render(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /create one/i }));

    await userEvent.type(screen.getByLabelText(/display name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password1');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(registerWithPassword).toHaveBeenCalledWith('a@b.com', 'password1', 'Ada'),
    );
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('surfaces a friendly message when Google is unavailable (503)', async () => {
    googleAvailable = true;
    googleSignIn.mockResolvedValue('id-token');
    loginWithGoogle.mockRejectedValue(new ApiError('GOOGLE_UNAVAILABLE', 'off', 503));
    render(<Login />);

    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    expect(await screen.findByText(/google sign-in isn't available/i)).toBeInTheDocument();
  });
});
