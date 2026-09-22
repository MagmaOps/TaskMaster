import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../api/auth';
import { setAccessToken, setAuthFailureHandler } from '../api/client';
import type { User } from '../api/types';
import { detectTimezone } from '../utils/timezone';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerWithPassword: (email: string, password: string, displayName: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Include the detected timezone only when available (backend defaults to UTC). */
function withTimezone<T extends object>(payload: T): T & { timezone?: string } {
  const timezone = detectTimezone();
  return timezone ? { ...payload, timezone } : payload;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Guard against setting state after unmount (bootstrap is async).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyAuthenticated = useCallback((nextUser: User, accessToken: string) => {
    setAccessToken(accessToken);
    setUser(nextUser);
    setStatus('authenticated');
  }, []);

  const applyUnauthenticated = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Terminal refresh failure during normal use -> log out.
  useEffect(() => {
    setAuthFailureHandler(() => {
      if (mountedRef.current) applyUnauthenticated();
    });
    return () => setAuthFailureHandler(null);
  }, [applyUnauthenticated]);

  // Bootstrap: try a silent refresh, then load the profile.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await authApi.refresh();
        setAccessToken(accessToken);
        const { user: profile } = await authApi.me();
        if (!cancelled) {
          setUser(profile);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) applyUnauthenticated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUnauthenticated]);

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const { user: nextUser, accessToken } = await authApi.login(
        withTimezone({ email, password }),
      );
      applyAuthenticated(nextUser, accessToken);
    },
    [applyAuthenticated],
  );

  const registerWithPassword = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: nextUser, accessToken } = await authApi.register(
        withTimezone({ email, password, displayName }),
      );
      applyAuthenticated(nextUser, accessToken);
    },
    [applyAuthenticated],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const { user: nextUser, accessToken } = await authApi.google(withTimezone({ idToken }));
      applyAuthenticated(nextUser, accessToken);
    },
    [applyAuthenticated],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort: clear local session regardless of network outcome.
    } finally {
      applyUnauthenticated();
    }
  }, [applyUnauthenticated]);

  const refreshProfile = useCallback(async () => {
    const { user: profile } = await authApi.me();
    setUser(profile);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      loginWithPassword,
      registerWithPassword,
      loginWithGoogle,
      logout,
      refreshProfile,
    }),
    [user, status, loginWithPassword, registerWithPassword, loginWithGoogle, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
