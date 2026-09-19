/** Shared domain types used across the backend. */

export type UserTier = 'free' | 'premium';

export interface UserSettings {
  project_priority_enabled: boolean;
  achievement_toasts_enabled: boolean;
  focus_mode_enabled: boolean;
  weight_visibility_enabled: boolean;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  project_priority_enabled: true,
  achievement_toasts_enabled: true,
  focus_mode_enabled: false,
  weight_visibility_enabled: false,
  theme: 'system',
};

/** A user row as stored in the database. */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  tier: UserTier;
  currency_balance: string; // bigint comes back as string from pg
  settings: UserSettings;
  created_at: Date;
  updated_at: Date;
}

/** User shape returned to clients (never includes password_hash). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: UserTier;
  currencyBalance: number;
  settings: UserSettings;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    tier: row.tier,
    currencyBalance: Number(row.currency_balance),
    settings: row.settings,
  };
}

export interface OAuthAccountRow {
  id: string;
  user_id: string;
  provider: 'google';
  provider_user_id: string;
  email: string | null;
  created_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  created_at: Date;
}

/** Express Request augmentation: authMiddleware sets req.userId. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
