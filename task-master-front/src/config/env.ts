/**
 * Typed access to Vite environment variables.
 *
 * The app always calls RELATIVE `/api/...` URLs. In dev, the Vite server proxies
 * `/api` to VITE_API_URL so requests are same-origin (required for the httpOnly
 * refresh cookie). In production behind the ingress, `/api` is routed to the
 * backend Service, so the relative base works unchanged.
 */
export const API_BASE = '/api';

/** Empty when Google OAuth is not configured -> the Google button is hidden. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

export const ENV = import.meta.env.VITE_ENV ?? 'development';

export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.trim().length > 0;
