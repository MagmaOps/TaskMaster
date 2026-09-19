# Authentication System Requirements

## Introduction

The Authentication System provides secure user registration, sign-in, and session management for the TaskMaster application. It supports two sign-in methods: **Google OAuth 2.0 (the primary, first-shown option)** and **email + password**. Sessions use short-lived JWT access tokens plus revocable, rotating refresh tokens. A single user account can have both a password credential and one or more linked OAuth identities.

This document supersedes the v1 auth requirements (which assumed password-only accounts and long-lived 7-day JWTs). It aligns with `docs/technical-specification.md` v2.0.

## Glossary

- **Auth_System**: The complete authentication module: registration, login, Google OAuth, token issuance/refresh, and logout.
- **User_Account**: A row in `users`; may authenticate via password, Google, or both.
- **OAuth_Account**: A row in `oauth_accounts` linking an external provider identity (Google `sub`) to a User_Account.
- **Access_Token**: Short-lived JWT (~15 min) sent as `Authorization: Bearer <token>` on protected requests.
- **Refresh_Token**: Long-lived (~30 day), opaque, random token used to obtain new Access_Tokens. Stored server-side only as a SHA-256 hash in `refresh_tokens`; delivered to web clients as an httpOnly, Secure, SameSite cookie. Rotated on every use.
- **Password_Hash**: bcrypt hash stored in `users.password_hash` (nullable — Google-only users have none).
- **Protected_Route**: An API endpoint requiring a valid Access_Token.
- **Authentication_Middleware**: Middleware that validates the Access_Token and attaches the user id to the request.

## Requirements

### Requirement 1 — Email + password registration

**User Story:** As a new user, I want to create an account with email and password, so that I can access TaskMaster without a Google account.

#### Acceptance Criteria
1. WHEN a user submits registration with a valid email and password, THE Auth_System SHALL create a User_Account with a bcrypt Password_Hash (≥ 10 salt rounds; 12 in production).
2. WHEN a user submits registration with an email that already belongs to a User_Account, THE Auth_System SHALL return a 400 "Email already exists" error without creating a duplicate.
3. THE Auth_System SHALL validate email format and enforce password strength (minimum 8 characters, containing at least one letter and one number).
4. WHEN registration succeeds, THE Auth_System SHALL issue an Access_Token and set a Refresh_Token cookie, and return the user profile.
5. THE Auth_System SHALL store the email in lowercase.
6. THE Auth_System SHALL never store or log plaintext passwords.

### Requirement 2 — Email + password login

**User Story:** As an existing user, I want to log in with my credentials, so that I can access my task data.

#### Acceptance Criteria
1. WHEN a user submits a valid email and password, THE Auth_System SHALL verify the password against the stored Password_Hash using bcrypt.
2. WHEN login succeeds, THE Auth_System SHALL issue a new Access_Token and set a new Refresh_Token cookie.
3. WHEN a user submits invalid credentials, THE Auth_System SHALL return a 401 with a generic "Invalid email or password" message that does not reveal which field was wrong.
4. WHEN a user attempts password login for an account that has no Password_Hash (Google-only), THE Auth_System SHALL return the same generic 401 message.
5. THE Auth_System SHALL perform case-insensitive email lookup (emails stored lowercase).

### Requirement 3 — Google OAuth sign-in (primary)

**User Story:** As a user, I want to sign in with Google as the first and easiest option, so that I don't need to manage a password.

#### Acceptance Criteria
1. THE Auth_System SHALL accept a Google ID token from the client at `POST /api/auth/google` and verify it server-side using the configured `GOOGLE_CLIENT_ID`.
2. WHEN the verified Google identity (`provider='google'`, `provider_user_id=sub`) matches an existing OAuth_Account, THE Auth_System SHALL sign the associated User_Account in.
3. WHEN no OAuth_Account matches but the verified Google email matches an existing User_Account, THE Auth_System SHALL link a new OAuth_Account to that user (account linking) and sign them in.
4. WHEN neither an OAuth_Account nor a matching email exists, THE Auth_System SHALL create a new User_Account (with `password_hash` null) plus an OAuth_Account, and sign them in, returning `isNewUser: true`.
5. WHEN Google verification fails, THE Auth_System SHALL return a 401 without creating any records.
6. WHEN `GOOGLE_CLIENT_ID` is not configured, THE Auth_System SHALL return 503 from `POST /api/auth/google`, and the frontend SHALL hide or disable the Google button.
7. WHEN a new User_Account is created via Google, THE Auth_System SHALL populate `display_name` and `avatar_url` from the Google profile when available.

### Requirement 4 — Sessions, access tokens, and refresh

**User Story:** As a logged-in user, I want to stay signed in safely without re-authenticating constantly, and I want the ability to revoke sessions.

#### Acceptance Criteria
1. WHEN a user accesses a Protected_Route with a valid Access_Token, THE Authentication_Middleware SHALL allow the request and attach the user id.
2. WHEN a user accesses a Protected_Route with an expired or invalid Access_Token, THE Authentication_Middleware SHALL return 401.
3. THE Auth_System SHALL set Access_Token expiration to approximately 15 minutes and Refresh_Token expiration to approximately 30 days.
4. WHEN a client calls `POST /api/auth/refresh` with a valid, non-revoked, non-expired Refresh_Token, THE Auth_System SHALL issue a new Access_Token, rotate the Refresh_Token (issue a new one, revoke the old), and return the new Access_Token.
5. WHEN a client calls `POST /api/auth/refresh` with a missing, expired, or revoked Refresh_Token, THE Auth_System SHALL return 401.
6. THE Auth_System SHALL store Refresh_Tokens only as SHA-256 hashes, never in plaintext.
7. WHEN a user calls `POST /api/auth/logout`, THE Auth_System SHALL revoke the current Refresh_Token and clear the cookie, returning 204.

### Requirement 5 — Security and configuration

**User Story:** As a security-conscious user, I want my credentials and sessions protected.

#### Acceptance Criteria
1. THE Auth_System SHALL sign Access_Tokens with a secret of at least 32 characters, injected via environment/secret (never hardcoded).
2. THE Auth_System SHALL apply rate limiting to `POST /api/auth/login`, `/register`, and `/google` to mitigate brute-force and abuse.
3. THE Auth_System SHALL set Refresh_Token cookies as httpOnly, SameSite, and Secure when served over HTTPS.
4. THE Auth_System SHALL enforce CORS to the configured frontend origin and support credentialed requests.
5. THE Auth_System SHALL deliver the Access_Token to the client in the response body (kept in memory by the client), not in a persistent cookie or localStorage.

### Requirement 6 — Profile access

**User Story:** As a logged-in user, I want to fetch my profile so the app can render my account state.

#### Acceptance Criteria
1. WHEN a user calls `GET /api/auth/me` with a valid Access_Token, THE Auth_System SHALL return the user's id, email, display_name, avatar_url, tier, currency_balance, and settings.
2. WHEN called without a valid Access_Token, THE Auth_System SHALL return 401.

### Requirement 7 — Clear error handling

**User Story:** As a user, I want clear, safe error messages when authentication fails.

#### Acceptance Criteria
1. WHEN registration fails due to an existing email, THE Auth_System SHALL return "Email already exists".
2. WHEN registration fails due to a weak password, THE Auth_System SHALL return the specific password requirements.
3. WHEN login fails due to invalid credentials, THE Auth_System SHALL return the generic "Invalid email or password".
4. WHEN a Protected_Route request is missing the Access_Token, THE Auth_System SHALL return "Authorization token required".
5. THE Auth_System SHALL return appropriate HTTP status codes: 400 validation, 401 unauthorized, 429 rate limited, 500 server error, 503 feature not configured.
