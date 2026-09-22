/**
 * Shared API types mirroring the backend response envelopes and public DTOs.
 * Source of truth: task-master-server authController + types/index.ts.
 */

export type UserTier = 'free' | 'premium';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserSettings {
  project_priority_enabled: boolean;
  achievement_toasts_enabled: boolean;
  focus_mode_enabled: boolean;
  weight_visibility_enabled: boolean;
  theme: ThemePreference;
  timezone: string;
}

/** User shape returned by the backend (never includes secrets). */
export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: UserTier;
  currencyBalance: number;
  settings: UserSettings;
}

/** Success envelope: `{ success: true, data }`. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Error envelope: `{ success: false, error: { code, message, details? } }`. */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Normalized error thrown by the API client. Carries the backend error `code`
 * (or a synthetic one like `NETWORK`/`UNKNOWN`) plus the HTTP status when known.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;

  constructor(code: string, message: string, status: number | null = null, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// --- Auth payloads ---

export interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
  timezone?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  timezone?: string;
}

export interface GooglePayload {
  idToken: string;
  timezone?: string;
}

export interface AuthData {
  user: User;
  accessToken: string;
  isNewUser?: boolean;
}

export interface RefreshData {
  accessToken: string;
}

export interface MeData {
  user: User;
}
