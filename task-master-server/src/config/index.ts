import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized, validated application configuration.
 * Reads from environment variables with sensible development defaults.
 */

const isProduction = process.env.NODE_ENV === 'production';

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  database: {
    url: string;
    ssl: boolean;
    poolMax: number;
    poolIdleTimeoutMs: number;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  bcryptRounds: number;
  google: {
    clientId: string;
    clientSecret: string;
    /** True when Google OAuth is configured and usable. */
    enabled: boolean;
  };
  cors: {
    origin: string;
    credentials: boolean;
  };
  limits: {
    maxProjectsPerUser: number;
  };
  economy: {
    premiumEarnRate: number;
  };
}

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';

export const config: AppConfig = {
  env: process.env.NODE_ENV ?? 'development',
  isProduction,
  port: parseInt(process.env.PORT ?? '3001', 10),
  database: {
    url: process.env.DATABASE_URL ?? '',
    ssl: isProduction,
    poolMax: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    poolIdleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_MS ?? '30000', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? (isProduction ? '12' : '10'), 10),
  google: {
    clientId: googleClientId,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    enabled: googleClientId.length > 0,
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  },
  limits: {
    maxProjectsPerUser: 20,
  },
  economy: {
    premiumEarnRate: parseFloat(process.env.ECONOMY_PREMIUM_EARN_RATE ?? '1.5'),
  },
};
