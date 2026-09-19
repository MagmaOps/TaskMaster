# Authentication System Design

## Overview

This design implements the requirements in `requirements.md`: dual sign-in (Google OAuth primary + email/password), short-lived JWT access tokens, and revocable rotating refresh tokens. It is part of a **greenfield rebuild**: the backend is a fresh TypeScript Express app with a fresh PostgreSQL schema created by two migrations, organized as routes → controllers → services → repositories → middleware.

Alignment: `docs/technical-specification.md` §3 (schema), §5.2–5.3 (API), §6.4 (frontend auth handling).

### Same-origin delivery (important)

The frontend and backend are served under a **single origin** via ingress path routing (`/` → frontend, `/api` → backend); locally the Vite dev server proxies `/api` to the backend. This keeps the refresh-token cookie same-site, so it uses `SameSite=Lax` (with `Secure` in production) rather than the weaker `SameSite=None`. The access token is returned in the response body and held in memory by the client.

## Architecture

```
Client (React)
  │  Google Identity Services → idToken
  │  or email/password form
  ▼
POST /api/auth/{google|login|register|refresh|logout|me}
  ▼
authRoutes → validation (express-validator) → rate limiter
  ▼
authController  (HTTP concerns, cookie set/clear, response envelopes)
  ▼
authService     (business logic: hashing, google verify, linking, token issue/rotate)
  ├── userRepository        (users, oauth_accounts)
  ├── refreshTokenRepository(refresh_tokens: create/find/revoke)
  ├── passwordService       (bcrypt hash/verify)
  ├── googleVerifier        (google-auth-library ID token verify)
  └── tokenService          (JWT sign/verify, refresh token generate/hash)
```

Protected routes elsewhere in the app use `authMiddleware`, which validates the access token and sets `req.userId`.

## Data Model

The schema is created fresh by two migrations under `src/database/migrations/` (TypeScript, run via `node-pg-migrate`). `gen_random_uuid()` is used for primary keys (`pgcrypto` extension enabled). Auth uses three of these tables:

### `users` (migration `1000000000000_init_users_and_auth`)
- `id uuid pk`, `email varchar(255) unique not null`
- `password_hash varchar(255) NULL` — **nullable** so Google-only accounts work
- `display_name varchar(255) null`, `avatar_url varchar(1024) null`
- `tier varchar(20) not null default 'free' check in ('free','premium')`
- `currency_balance bigint not null default 0`
- `settings jsonb not null default '{}'`, `created_at`, `updated_at` (timestamptz)

### `oauth_accounts` (same migration)
- `id uuid pk`, `user_id uuid fk→users ON DELETE CASCADE not null`
- `provider varchar(20) not null check in ('google')`
- `provider_user_id varchar(255) not null` (Google `sub`)
- `email varchar(255) null`, `created_at timestamptz`
- Indexes: `UNIQUE (provider, provider_user_id)`, `INDEX (user_id)`

### `refresh_tokens` (same migration)
- `id uuid pk`, `user_id uuid fk→users ON DELETE CASCADE not null`
- `token_hash varchar(255) unique not null` (SHA-256 of the raw token)
- `expires_at timestamptz not null`, `revoked_at timestamptz null`
- `user_agent varchar(512) null`, `created_at timestamptz`
- Indexes: `UNIQUE (token_hash)`, `INDEX (user_id)`

The second migration (`1000000000001_init_tasks_projects_gamification`) creates the remaining domain tables and is owned by the other feature specs. Both migrations have reversible `down` functions.

## Components and Interfaces

### tokenService (`src/services/auth/tokenService.ts`)
- `signAccessToken(userId: string): string` — JWT with `sub=userId`, `exp≈15m` (`JWT_ACCESS_TTL`), signed with `JWT_ACCESS_SECRET`.
- `verifyAccessToken(token: string): { userId: string }` — throws `ApiError(TOKEN_INVALID)` on invalid/expired.
- `generateRefreshToken(): { raw: string; hash: string }` — 384-bit random (base64url); hash = SHA-256(raw).
- `hashRefreshToken(raw: string): string`, `refreshTokenExpiry(): Date`.

### passwordService (`src/services/auth/passwordService.ts`)
- `hashPassword(password: string): Promise<string>` — bcrypt with configured rounds.
- `verifyPassword(password: string, hash: string): Promise<boolean>`.
- `validatePasswordStrength(password): string | null` — returns a requirement message or null if valid.

### googleVerifier (`src/services/auth/googleVerifier.ts`)
- `verifyGoogleIdToken(idToken: string): Promise<GoogleProfile>` where `GoogleProfile = { sub, email, emailVerified, name, picture }`. Uses `google-auth-library` `OAuth2Client.verifyIdToken` with `audience=GOOGLE_CLIENT_ID`. Throws `GOOGLE_NOT_CONFIGURED` (503) if unset, `GOOGLE_VERIFY_FAILED` (401) on invalid token.

### userRepository (`src/repositories/userRepository.ts`)
- `findByEmail(email)`, `findById(id)`, `createPasswordUser({email, passwordHash, displayName?})`, `createOAuthUser({email, displayName, avatarUrl, provider, providerUserId})` (transactional: user + oauth row), `findOAuthAccount(provider, providerUserId)`, `linkOAuthAccount({userId, provider, providerUserId, email})`.

### refreshTokenRepository (`src/repositories/refreshTokenRepository.ts`)
- `create({userId, tokenHash, expiresAt, userAgent})`, `findValidByHash(tokenHash)` (not revoked, not expired), `revoke(id)`, `revokeByHash(tokenHash)`, `revokeAllForUser(userId)`.

### authService (`src/services/auth/authService.ts`)
- `register({email, password, displayName?, userAgent?})` → validate strength → uniqueness → hash → create user → issue tokens.
- `login({email, password, userAgent?})` → find user → generic error if missing OR no password_hash → verify → issue tokens.
- `loginWithGoogle({idToken, userAgent?})` → verify → find OAuth account → else link by verified email → else create user+oauth → issue tokens; returns `AuthResult` with `isNewUser`.
- `refresh({rawRefreshToken, userAgent?})` → hash → find valid → revoke old → issue new (rotation).
- `logout(rawRefreshToken?)` → hash → revokeByHash (no-op if absent).
- `getProfile(userId)` → `PublicUser`.
- Internal `issueTokens(user, userAgent?)` returns `{ user: PublicUser, accessToken, refreshToken(raw), isNewUser? }`.

`PublicUser` never includes `password_hash`; `bigint currency_balance` is converted to `number`.

### authController (`src/controllers/authController.ts`)
Sets/clears the refresh cookie (`httpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `path=/api/auth`), returns `{ success: true, data: { user, accessToken, isNewUser? } }`, delegates errors to `next()`.

### authMiddleware (`src/middleware/authMiddleware.ts`)
Reads `Authorization: Bearer`, verifies access token, sets `req.userId`; forwards `TOKEN_REQUIRED` (401) if missing, `TOKEN_INVALID` (401) if invalid/expired.

## API Endpoints (summary)
- `POST /api/auth/register` → 201 `{user, accessToken}` + refresh cookie
- `POST /api/auth/login` → 200 `{user, accessToken}` + refresh cookie
- `POST /api/auth/google` → 200 `{user, accessToken, isNewUser}` + refresh cookie (503 if unconfigured)
- `POST /api/auth/refresh` → 200 `{accessToken}` (rotates cookie)
- `POST /api/auth/logout` → 204
- `GET  /api/auth/me` → 200 `{user}`

## Error Handling
- Central error middleware (`src/middleware/errorHandler.ts`) produces `{ success:false, error:{ code, message, details? } }` from `ApiError`, and a generic 500 `INTERNAL_ERROR` for anything else (details never leaked).
- Auth-specific codes: `EMAIL_EXISTS` (400), `WEAK_PASSWORD` (400), `VALIDATION_ERROR` (400), `INVALID_CREDENTIALS` (401), `TOKEN_REQUIRED` (401), `TOKEN_INVALID` (401), `GOOGLE_VERIFY_FAILED` (401), `GOOGLE_NOT_CONFIGURED` (503), `RATE_LIMITED` (429).
- Login never distinguishes "no such user" from "wrong password".

## Security Considerations
- Access token in memory on client; refresh token in httpOnly, SameSite=Lax cookie (Secure in prod) → mitigates XSS token theft while working same-origin.
- Refresh tokens hashed at rest; rotation limits replay; `revokeAllForUser` supports a future "log out everywhere".
- **Rate limiting:** `express-rate-limit` on `/register`, `/login`, `/google` at **10 requests/min/IP** (429 `RATE_LIMITED`).
- bcrypt rounds 10 dev / 12 prod (from config).
- CORS locked to `CORS_ORIGIN` with `credentials: true`.
- `helmet` for security headers; `cookie-parser` to read the refresh cookie.
- All queries parameterized ($1,$2,…) — no string interpolation.

## Testing Strategy
- **Unit (no DB):** tokenService (sign/verify/expiry, refresh hash), passwordService (hash/verify/strength), authService flows with mocked repositories + mocked googleVerifier (register, login generic error, google new vs link vs existing, refresh rotation, logout).
- **Integration (Supertest + Postgres):** register→me happy path; duplicate email 400; wrong-password generic 401; refresh rotation + reuse-after-revoke rejected; logout revokes; 503 when `GOOGLE_CLIENT_ID` unset. Google happy-path is covered at the service layer with a mocked verifier (real Google tokens aren't available in tests).
- **Test DB:** a dedicated `taskmaster_test` database is added to `docker-compose.yml`; Jest loads `.env.test` (separate `DATABASE_URL`) and runs migrations before the suite via a global setup. Tests truncate tables between runs.
