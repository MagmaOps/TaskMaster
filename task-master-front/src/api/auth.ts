import { api, unwrap, normalizeError } from './client';
import type {
  AuthData,
  GooglePayload,
  LoginPayload,
  MeData,
  RefreshData,
  RegisterPayload,
} from './types';

/**
 * Typed wrappers over the backend auth endpoints. Each returns unwrapped `data`
 * and throws a normalized ApiError on failure. Response interceptor handles
 * 401->refresh; these wrappers only normalize the thrown error for callers that
 * bypass the interceptor path (e.g. non-401 failures).
 */

export async function register(payload: RegisterPayload): Promise<AuthData> {
  try {
    const res = await api.post<{ success: true; data: AuthData }>('/auth/register', payload);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function login(payload: LoginPayload): Promise<AuthData> {
  try {
    const res = await api.post<{ success: true; data: AuthData }>('/auth/login', payload);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function google(payload: GooglePayload): Promise<AuthData> {
  try {
    const res = await api.post<{ success: true; data: AuthData }>('/auth/google', payload);
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function refresh(): Promise<RefreshData> {
  try {
    const res = await api.post<{ success: true; data: RefreshData }>('/auth/refresh', {});
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function me(): Promise<MeData> {
  try {
    const res = await api.get<{ success: true; data: MeData }>('/auth/me');
    return unwrap(res);
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', {});
  } catch (err) {
    // Logout should be best-effort; still normalize for callers that care.
    throw normalizeError(err);
  }
}
