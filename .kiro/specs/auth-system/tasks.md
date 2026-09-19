# Authentication System Implementation Tasks

Greenfield TypeScript Express backend. Progress is tracked below; `[x]` items are already implemented and verified. Tasks marked `*` are optional.

- [x] 1. Set up TypeScript backend scaffolding
  - package.json (deps: express, pg, bcrypt, jsonwebtoken, google-auth-library, helmet, cors, cookie-parser, express-rate-limit, express-validator; dev: typescript, tsx, ts-node, jest, ts-jest, supertest, eslint, prettier)
  - tsconfig.json (ES2022, strict), config module + validateEnv, `.env.example` + local `.env`
  - Database connection pool (`src/database/pool.ts`: query/withTransaction/checkConnection/closePool)
  - Error types + ApiError (`src/utils/errors.ts`), shared domain types (`src/types/index.ts`)
  - _Requirements: 5.1, 5.4_

- [x] 2. Create database schema (fresh migrations)
  - [x] 2.1 Migration `1000000000000_init_users_and_auth` (users w/ nullable password_hash + tier/currency/profile; oauth_accounts; refresh_tokens)
  - [x] 2.2 Migration `1000000000001_init_tasks_projects_gamification` (remaining domain tables)
  - [x] 2.3 Ran migrations up against local Postgres; verified all 10 tables exist
  - _Requirements: 1.1, 3.4, 3.7, 4.4, 4.6_

- [x] 3. Token and password services
  - [x] 3.1 tokenService (sign/verify access JWT; generate/hash refresh token; expiry helper)
  - [x] 3.2 passwordService (bcrypt hash/verify + strength validation)
  - _Requirements: 1.1, 1.6, 2.1, 4.1, 4.2, 4.3, 4.6, 5.1_

- [x] 4. Repositories
  - [x] 4.1 userRepository (findByEmail/findById, createPasswordUser, createOAuthUser [transactional], findOAuthAccount, linkOAuthAccount)
  - [x] 4.2 refreshTokenRepository (create, findValidByHash, revoke, revokeByHash, revokeAllForUser)
  - _Requirements: 1.1, 1.2, 2.5, 3.2, 3.3, 3.4, 4.4, 4.5, 4.7_

- [x] 5. Google verifier
  - googleVerifier.verifyGoogleIdToken (audience = GOOGLE_CLIENT_ID; 503 when unset)
  - _Requirements: 3.1, 3.5, 3.6_

- [x] 6. authService
  - register, login (generic error incl. Google-only), loginWithGoogle (find/link/create), refresh (rotation), logout, getProfile
  - _Requirements: 1.1–1.6, 2.1–2.5, 3.1–3.7, 4.4, 4.7, 6.1_

- [x] 7. authMiddleware
  - Verify Bearer access token, set req.userId; TOKEN_REQUIRED / TOKEN_INVALID
  - _Requirements: 4.1, 4.2, 7.4_

- [x] 8. Error handler + app wiring
  - [x] 8.1 Central error middleware (`errorHandler.ts`) → standard error envelope; generic 500
  - [x] 8.2 Express app (`app.ts`): helmet, cors(credentials), json, cookie-parser, mount `/api`, `/health`, 404 + error handler
  - [x] 8.3 Server bootstrap (`server.ts`): validateEnv, checkConnection, listen, graceful shutdown
  - _Requirements: 5.3, 5.4, 7.5_

- [x] 9. authController + routes
  - [x] 9.1 authController (cookie set/clear on `path=/api/auth`, response envelopes, next(err))
  - [x] 9.2 express-validator rules (email/password/idToken) + rate limiter (10/min/IP; skipped in test) on register/login/google
  - [x] 9.3 authRoutes mounting register/login/google/refresh/logout/me
  - _Requirements: 1.3, 1.4, 2.2, 3.4, 4.4, 4.7, 5.2, 5.3, 5.5, 6.1, 6.2, 7.1–7.5_

- [x] 10. Tests (22 passing across 4 suites)
  - [x] 10.1 Unit: tokenService, passwordService, authService google logic (mocked repos + verifier)
  - [x] 10.2 Integration (Supertest): register→me; duplicate email; weak/wrong password; refresh rotation + reuse rejected; logout revokes; 503 when Google unset
  - [x] 10.3 Test DB: added `taskmaster_test` to docker-compose; `.env.test`; Jest global setup runs migrations + truncates between tests
  - _Requirements: 1.2, 2.3, 3.6, 4.4, 4.5, 4.7_

- [ ]* 11. Optional hardening (post-MVP)
  - [ ]* 11.1 "Log out everywhere" endpoint using revokeAllForUser
  - [ ]* 11.2 Active-sessions listing (device/user_agent) for the profile page
  - _Requirements: 4.7_
