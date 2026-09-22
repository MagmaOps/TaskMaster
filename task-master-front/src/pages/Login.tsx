import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn';
import { ApiError } from '../api/types';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import './Login.css';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Map backend error codes (and client validation) to friendly copy. */
function friendlyError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INVALID_CREDENTIALS':
      case 'UNAUTHORIZED':
        return 'That email or password is incorrect.';
      case 'EMAIL_TAKEN':
      case 'DUPLICATE_ENTRY':
        return 'An account with this email already exists. Try signing in instead.';
      case 'VALIDATION_ERROR':
        return 'Please check the details you entered and try again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'NETWORK':
        return 'Unable to reach the server. Check your connection and try again.';
      default:
        return mode === 'register'
          ? 'We could not create your account. Please try again.'
          : 'We could not sign you in. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export default function Login() {
  const navigate = useNavigate();
  const { loginWithPassword, registerWithPassword, loginWithGoogle } = useAuth();
  const google = useGoogleSignIn();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ [k: string]: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const validate = (): boolean => {
    const errs: { [k: string]: string } = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD)
      errs.password = `Password must be at least ${MIN_PASSWORD} characters.`;
    if (mode === 'register' && displayName.trim().length === 0)
      errs.displayName = 'Display name is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await loginWithPassword(email.trim(), password);
      } else {
        await registerWithPassword(email.trim(), password, displayName.trim());
      }
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(friendlyError(err, mode));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleError(null);
    try {
      const idToken = await google.signIn();
      await loginWithGoogle(idToken);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setGoogleError("Google sign-in isn't available right now. Use email and password below.");
      } else {
        setGoogleError('Google sign-in did not complete. Please try again or use email below.');
      }
    }
  };

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setFieldErrors({});
    setFormError(null);
  };

  return (
    <main className="login">
      <div className="login__card">
        <h1 className="login__title">TaskMaster</h1>
        <p className="login__subtitle">
          {mode === 'login' ? 'Sign in to see what’s next.' : 'Create your account.'}
        </p>

        {google.available && (
          <>
            <Button variant="secondary" fullWidth onClick={handleGoogle} type="button">
              Continue with Google
            </Button>
            {googleError && (
              <p className="login__error" role="alert">
                {googleError}
              </p>
            )}
            <div className="login__divider" aria-hidden="true">
              <span>or</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <Input
              label="Display name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={fieldErrors.displayName}
            />
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
          />
          <Input
            label="Password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />

          {formError && (
            <p className="login__error" role="alert">
              {formError}
            </p>
          )}

          <Button type="submit" fullWidth loading={submitting}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className="login__toggle">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="login__toggle-btn" onClick={toggleMode}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </main>
  );
}
