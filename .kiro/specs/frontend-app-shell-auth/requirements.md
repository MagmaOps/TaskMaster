# Frontend App-Shell + Auth — Requirements

## Introduction

This is the **first of four sequential frontend specs** for TaskMaster's greenfield React 18 + TypeScript + Vite PWA (`task-master-front/`). It establishes the foundation every later frontend feature depends on: project scaffold, authentication flow, API client with token handling, theming (including dark mode), routing with route protection, and the app-shell layout (bottom navigation + header). It also stands up the Vitest + React Testing Library harness.

The backend API is feature-complete. This spec consumes the existing auth surface only:
`POST /api/auth/{register,login,google,refresh,logout}`, `GET /api/auth/me`, `PATCH /api/auth/me`.

Scope boundary: this spec delivers a working login → authenticated shell → logout loop with a placeholder landing page. Task list, projects, profile, and settings **content** are later specs; this spec provides only the navigational shell and route slots they will fill.

Later specs (out of scope here, listed for context): task views / "What's Next?", projects management, profile + settings.

## Glossary

- **Access token:** short-lived (15m) JWT returned by auth endpoints, held in memory only.
- **Refresh cookie:** `tm_refresh`, httpOnly, set by the backend; the browser sends it automatically. The frontend never reads it.
- **Silent refresh:** exchanging the refresh cookie for a new access token via `POST /api/auth/refresh` without user interaction.
- **App shell:** the persistent layout (header + bottom navigation) wrapping authenticated pages.
- **Protected route:** a route that requires an authenticated session; redirects to Login otherwise.

## Requirements

### Requirement 1 — Project scaffold & tooling

**User Story:** As the developer, I want a Vite + React 18 + TypeScript PWA scaffold with the agreed libraries and scripts, so that all later frontend specs build on a consistent, verifiable foundation.

#### Acceptance Criteria

1. WHEN the frontend project is created THEN it SHALL live in `task-master-front/` with React 18, TypeScript (strict), and Vite as the build tool.
2. THE project SHALL include these runtime dependencies: `react`, `react-dom`, `react-router-dom` (v6), `axios`, `date-fns`; and dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `vite-plugin-pwa`, `eslint`, `prettier`.
3. THE `package.json` SHALL define scripts: `dev`, `build`, `preview`, `test`, `test:coverage`, `lint`, `format`, `typecheck`.
4. WHEN `npm run typecheck` runs THEN it SHALL pass with no errors.
5. WHEN `npm test` runs THEN Vitest SHALL execute with the jsdom environment and RTL matchers available, and all tests SHALL pass.
6. THE Vite dev server SHALL proxy `/api` to the backend base URL (`VITE_API_URL`, default `http://localhost:3001`) so the browser makes same-origin requests in dev (required for the httpOnly refresh cookie).
7. THE project SHALL provide `.env.example`, `.env.development`, and `.env.production` documenting `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_ENV`; real `.env.local` SHALL be gitignored.
8. THE PWA plugin SHALL be configured with a web app manifest (name, theme color, icons) and auto-update service worker registration; service-worker behavior is not asserted by tests in this spec.

### Requirement 2 — API client & token handling

**User Story:** As a user, I want my session to persist securely and refresh transparently, so that I stay logged in without exposing tokens to XSS.

#### Acceptance Criteria

1. THE app SHALL hold the access token in memory only (module-scoped/context state), never in `localStorage` or `sessionStorage`.
2. THE axios instance SHALL be created with `withCredentials: true` so the httpOnly refresh cookie is sent on `/api/auth/refresh`.
3. WHEN an authenticated request is made AND an access token is present THEN the client SHALL attach `Authorization: Bearer <token>`.
4. WHEN a request returns `401` AND it is not itself the refresh call AND it has not already been retried THEN the client SHALL call `POST /api/auth/refresh` once, and on success update the in-memory access token and retry the original request exactly once.
5. WHEN the refresh call fails (any non-2xx) THEN the client SHALL clear the in-memory token, mark the session unauthenticated, and surface the failure so the app redirects to Login.
6. WHEN multiple requests fail with `401` concurrently THEN the client SHALL perform at most one refresh call and queue the waiting requests until it resolves.
7. THE client SHALL parse the backend response envelopes: success `{ success: true, data }` and error `{ success: false, error: { code, message, details? } }`, exposing a typed error (code + message) to callers.

### Requirement 3 — Authentication context & session lifecycle

**User Story:** As a user, I want to sign in, stay signed in across reloads, and sign out, so that the app reflects my session state reliably.

#### Acceptance Criteria

1. THE `AuthContext` SHALL expose: `user` (or null), `status` (`loading` | `authenticated` | `unauthenticated`), and actions `loginWithPassword`, `registerWithPassword`, `loginWithGoogle`, `logout`, and `refreshProfile`.
2. WHEN the app first mounts THEN AuthContext SHALL attempt a silent refresh (`/api/auth/refresh`); on success it SHALL fetch `GET /api/auth/me` and enter `authenticated`, otherwise enter `unauthenticated`.
3. WHILE the initial silent refresh is in flight THE app SHALL render a full-screen loading state and SHALL NOT flash the Login page.
4. WHEN `loginWithPassword` or `registerWithPassword` succeeds THEN AuthContext SHALL store the returned access token, set `user`, and enter `authenticated`.
8. WHEN any of `registerWithPassword`, `loginWithPassword`, or `loginWithGoogle` is invoked THEN AuthContext SHALL include the browser's detected IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) as the optional `timezone` field in the request, so the user's timezone is captured and kept current automatically with no timezone UI. IF detection is unavailable THEN the field SHALL be omitted (backend defaults to UTC).
5. WHEN `logout` is invoked THEN the app SHALL call `POST /api/auth/logout`, clear the in-memory token and `user`, and enter `unauthenticated` even if the network call fails.
6. WHEN a `401`-driven refresh ultimately fails during normal use THEN AuthContext SHALL transition to `unauthenticated` and the user SHALL land on Login.
7. THE `useAuth` hook SHALL throw if used outside `AuthProvider`.

### Requirement 4 — Login page (Google first, then email/password)

**User Story:** As a user, I want to sign in with Google or email/password, so that I can access the app through my preferred method.

#### Acceptance Criteria

1. THE Login page SHALL display the Google sign-in option FIRST (above the email/password form), matching product ordering.
2. IF `VITE_GOOGLE_CLIENT_ID` is empty or unset THEN the Google option SHALL be hidden and only email/password SHALL be shown.
3. WHEN the Google option is present AND the user completes Google sign-in THEN the frontend SHALL obtain a Google ID token and POST it to `/api/auth/google`.
4. IF `/api/auth/google` returns `503` (Google not configured server-side) THEN the UI SHALL show a friendly "Google sign-in isn't available right now" message and keep email/password usable.
5. THE email/password form SHALL provide a Login mode and a Register mode. Login mode SHALL have email and password fields. Register mode SHALL have email, password, and a **required display name** field (display name is a non-unique label; the form SHALL reject an empty display name and enforce max length 255). The form SHALL validate that email is non-empty and well-formed and that password is at least 8 characters (matching the backend) before submitting.
6. WHEN a submission fails THEN the page SHALL show a friendly, specific error message derived from the backend error envelope (e.g. invalid credentials, email already registered) without leaking raw error codes.
7. WHILE a submission is in flight THE submit control SHALL show a loading state and SHALL be disabled to prevent double submit.
8. WHEN authentication succeeds THEN the user SHALL be redirected to the landing route (Tasks).
9. THE form SHALL be keyboard-navigable and use semantic labels associated with each input.

### Requirement 5 — Routing & route protection

**User Story:** As a user, I want the app to route me correctly based on my auth state, so that I only see protected content when signed in.

#### Acceptance Criteria

1. THE app SHALL define routes for Login (`/login`) and the protected shell routes: Tasks (`/`), Projects (`/projects`), Profile (`/profile`), Settings (`/settings`).
2. WHEN an unauthenticated user navigates to any protected route THEN they SHALL be redirected to `/login`.
3. WHEN an authenticated user navigates to `/login` THEN they SHALL be redirected to the landing route (`/`).
4. WHEN an unknown route is requested THEN the app SHALL redirect to the landing route (authenticated) or `/login` (unauthenticated).
5. Protected pages other than the ones delivered in this spec SHALL render a minimal placeholder within the shell (filled by later specs).

### Requirement 6 — App-shell layout

**User Story:** As a user, I want a consistent shell with a header and bottom navigation, so that I can move between the main sections one-handed on mobile.

#### Acceptance Criteria

1. THE app shell SHALL render a `BottomNav` with five slots in order: Tasks, Projects, large center Add (+), Profile, Settings.
2. THE center Add (+) control SHALL be present and prominent; wiring it to the Quick-Add modal is a later spec, so in this spec it MAY be a no-op or disabled placeholder that is visually prominent.
3. THE `BottomNav` SHALL indicate the active section based on the current route.
4. THE shell SHALL render a `Header` showing the app name and an account **dropdown menu** (avatar/name trigger) that contains the Logout action, so logout requires an explicit two-step interaction (open menu → Logout) and cannot be triggered by a single accidental tap. The menu SHALL be keyboard-accessible (open/close, focus management) and dismiss on outside click or Escape.
5. THE shell SHALL be responsive down to 320px width and keep the bottom navigation within the mobile thumb zone.
6. Navigation controls SHALL be keyboard-accessible with visible focus states and appropriate ARIA labels.

### Requirement 7 — Theming & dark mode

**User Story:** As a user, I want light, dark, and system themes, so that the app is comfortable in any environment.

#### Acceptance Criteria

1. THE app SHALL define color tokens as CSS variables with light and dark theme values.
2. THE `SettingsContext` SHALL expose a `theme` preference of `light` | `dark` | `system` and a setter, defaulting to `system`.
3. WHEN `theme` is `system` THEN the app SHALL follow the OS `prefers-color-scheme` and update live when it changes.
4. WHEN the user selects `light` or `dark` THEN the app SHALL apply that theme immediately and persist the choice locally so it survives reload.
5. THE theme SHALL be applied before first paint where feasible to avoid a flash of the wrong theme.
6. Theme token contrast SHALL meet WCAG AA for normal text in both light and dark themes. (Full compliance requires manual verification; this criterion covers the token definitions.)

### Requirement 8 — Shared UI primitives, toast, and error boundary

**User Story:** As the developer, I want a small set of reusable primitives and a global feedback surface, so that later specs stay consistent and resilient.

#### Acceptance Criteria

1. THE `common/` folder SHALL provide reusable `Button`, `Input`, and `Spinner` components with accessible markup (labels/roles, focus states).
2. THE app SHALL provide a `Toast` surface that overlays content and can display transient messages; later specs (achievements) will extend it, so this spec SHALL expose a minimal `showToast(message)` mechanism via context.
3. THE app SHALL wrap the routed tree in an error boundary that renders a friendly fallback instead of a blank screen when a render error occurs.
4. WHEN an API call fails in a way not otherwise handled THEN the app SHALL surface a friendly message (via toast or inline) rather than an unhandled rejection.

### Requirement 9 — Automatic timezone capture

**User Story:** As a user, I want the app to know my timezone without asking me, so that dates, streaks, and "today" are correct with zero setup.

#### Acceptance Criteria

1. THE app SHALL detect the browser IANA timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
2. WHEN registering, logging in with password, or signing in with Google THEN the detected timezone SHALL be sent as the optional `timezone` field on that request.
3. IF timezone detection returns a falsy/invalid value THEN the `timezone` field SHALL be omitted and the backend default (UTC) SHALL apply; the auth flow SHALL NOT fail on account of timezone.
4. THE app SHALL NOT present any timezone picker or prompt in this spec (an explicit timezone editor belongs to the later settings spec).

## Non-Goals

- Task, project, profile, and settings **content** beyond the shell/placeholder and the theme setting (later specs).
- Offline-first sync, push notifications (out of MVP scope).
- Wiring the center Add (+) to the Quick-Add modal (task-views spec).
- Server-side rendering.

## Traceability to product docs

- Google-first login ordering and hide-when-unconfigured: PRD §3.1, tech-spec §6.1.
- In-memory access token + axios refresh interceptor + same-origin dev proxy: tech-spec §6.4, §7.2.
- Bottom navigation five-button structure: PRD §3.6.
- Dark mode in MVP scope: PRD §9 note, tech-spec §1 (theming via CSS variables).
- Context providers (`AuthContext`, `SettingsContext`): tech-spec §6.3.
