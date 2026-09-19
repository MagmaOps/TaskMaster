import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config';
import { ApiError } from '../../utils/errors';

/**
 * Verifies Google ID tokens server-side. Returns the essential profile claims.
 * Throws GOOGLE_NOT_CONFIGURED (503) when no client id is set, and
 * GOOGLE_VERIFY_FAILED (401) when the token is invalid.
 */

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!config.google.enabled) {
    throw ApiError.serviceUnavailable('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured');
  }
  if (!client) {
    client = new OAuth2Client(config.google.clientId);
  }
  return client;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const oauthClient = getClient();
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      throw new Error('missing subject');
    }
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified ?? false,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.unauthorized('GOOGLE_VERIFY_FAILED', 'Google token verification failed');
  }
}
