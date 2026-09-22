import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { API_BASE } from '../config/env';
import { ApiError, type ApiErrorEnvelope } from './types';

/**
 * Central axios instance + auth/token handling.
 *
 * - Access token is held in memory only (never localStorage) to limit XSS blast radius.
 * - The refresh token lives in the httpOnly `tm_refresh` cookie; JS never reads it.
 *   `withCredentials: true` + the same-origin dev proxy ensure it is sent on /auth/refresh.
 * - On a 401 the client performs a single-flight refresh and retries the original
 *   request once. Concurrent 401s share one refresh call.
 */

const REFRESH_PATH = '/auth/refresh';

// --- in-memory access token store (owned by AuthContext lifecycle) ---
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// --- terminal auth-failure handler (AuthContext registers this on mount) ---
type AuthFailureHandler = () => void;
let authFailureHandler: AuthFailureHandler | null = null;

/** Register a callback invoked when a refresh ultimately fails (session is dead). */
export function setAuthFailureHandler(handler: AuthFailureHandler | null): void {
  authFailureHandler = handler;
}

// Extend the axios request config with our one-shot retry flag.
interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the bearer token when present.
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

// --- single-flight refresh ---
let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  // Use a bare axios call (not `api`) so the response interceptor does not recurse.
  const res = await axios.post<{ success: true; data: { accessToken: string } }>(
    `${API_BASE}${REFRESH_PATH}`,
    {},
    { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
  );
  const token = res.data?.data?.accessToken;
  if (!token) {
    throw new Error('Refresh response missing accessToken');
  }
  return token;
}

function refreshOnce(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryConfig | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    const isRefreshCall = url.includes(REFRESH_PATH);

    // Only handle a genuine 401 on a non-refresh request that we have not retried.
    if (status === 401 && original && !original._retry && !isRefreshCall) {
      original._retry = true;
      try {
        const token = await refreshOnce();
        setAccessToken(token);
        original.headers.set('Authorization', `Bearer ${token}`);
        return api(original);
      } catch {
        // Refresh failed: session is terminal.
        setAccessToken(null);
        authFailureHandler?.();
        throw normalizeError(error);
      }
    }

    throw normalizeError(error);
  },
);

/** Convert an axios failure into a typed ApiError using the backend envelope. */
export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null;
    const body = error.response?.data as ApiErrorEnvelope | undefined;
    if (body && body.success === false && body.error) {
      return new ApiError(body.error.code, body.error.message, status, body.error.details);
    }
    if (!error.response) {
      return new ApiError(
        'NETWORK',
        'Unable to reach the server. Check your connection and try again.',
        null,
      );
    }
    return new ApiError('UNKNOWN', error.message || 'An unexpected error occurred', status);
  }

  return new ApiError('UNKNOWN', 'An unexpected error occurred');
}

/** Unwrap a `{ success: true, data }` envelope to its `data`, throwing on error shapes. */
export function unwrap<T>(response: AxiosResponse<{ success: true; data: T }>): T {
  return response.data.data;
}
