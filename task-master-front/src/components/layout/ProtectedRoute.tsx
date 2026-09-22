import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Spinner } from '../common/Spinner';
import { AppShell } from './AppShell';

/**
 * Guards the protected route group. While the session is bootstrapping we show a
 * full-screen spinner (never flashing Login). Unauthenticated users are sent to
 * /login; authenticated users get the app shell with the nested route outlet.
 */
export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <Spinner fullscreen label="Loading TaskMaster" />;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
}

/** Redirects an already-authenticated user away from /login to the landing route. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return <Spinner fullscreen label="Loading TaskMaster" />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Unknown routes: send authenticated users home, others to login. */
export function CatchAllRedirect() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <Spinner fullscreen label="Loading TaskMaster" />;
  }
  return <Navigate to={status === 'authenticated' ? '/' : '/login'} replace />;
}
