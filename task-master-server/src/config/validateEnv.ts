import { config } from './index';

/**
 * Validates required environment variables at startup.
 * Throws with a clear message listing everything missing.
 */
export function validateEnv(): void {
  const missing: string[] = [];

  if (!config.database.url) missing.push('DATABASE_URL');
  if (!config.jwt.accessSecret) missing.push('JWT_ACCESS_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See task-master-server/.env.example.`,
    );
  }

  if (config.jwt.accessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters long.');
  }

  if (!config.google.enabled) {
    // Not fatal — Google sign-in is optional until a client id is configured.
    // eslint-disable-next-line no-console
    console.warn('⚠️  GOOGLE_CLIENT_ID not set — Google sign-in disabled (POST /api/auth/google -> 503).');
  }
}
