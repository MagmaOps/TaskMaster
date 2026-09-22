# Frontend App-Shell + Auth — Design

## Overview

Greenfield React 18 + TypeScript + Vite PWA in `task-master-front/`. This spec delivers the foundation: scaffold, API/token layer, auth context, login page, routing + protection, app-shell layout, theming (light/dark/system), and shared primitives. All later frontend specs plug into the slots this establishes.

The design mirrors the backend's layering discipline: **api client → context (state) → pages/components**, keeping side-effecting network code out of components.

## Directory layout (created in this spec)

```
task-master-front/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts                 # react plugin, PWA plugin, dev proxy, vitest config
├── .env.example / .env.development / .env.production
├── public/
│   ├── manifest.webmanifest       # (generated/managed by vite-plugin-pwa)
│   └── icons/                     # PWA icons (placeholder set)
└── src/
    ├── main.tsx                   # root render, providers, theme pre-paint
    ├── App.tsx                    # router + route table
    ├── vite-env.d.ts
    ├── config/
    │   └── env.ts                 # typed access to import.meta.env
    ├── api/
    │   ├── client.ts              # axios instance, interceptors, refresh queue
    │   ├── auth.ts                # auth endpoint wrappers
    │   └── types.ts               # envelope + DTO types (ApiError, User, ...)
    ├── contexts/
    │   ├── AuthContext.tsx        # session lifecycle
    │   ├── SettingsContext.tsx    # theme preference
    │   └── ToastContext.tsx       # showToast surface
    ├── pages/
    │   ├── Login.tsx
    │   └── Placeholder.tsx        # temporary Tasks/Projects/Profile/Settings body
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx        # header + <Outlet/> + bottom nav
    │   │   ├── Header.tsx
    │   │   ├── BottomNav.tsx
    │   │   ├── ThemeProvider.tsx   # applies theme -> data-theme attribute
    │   │   ├── Toast.tsx           # visual surface for ToastContext
    │   │   └── ProtectedRoute.tsx  # guards + redirect logic
    │   └── common/
    │       ├── Button.tsx
    │       ├── Input.tsx
    │       └── Spinner.tsx
    ├── hooks/
    │   └── useGoogleSignIn.ts      # loads GIS, returns ID token (no-op if unconfigured)
    ├── styles/
    │   ├── tokens.css              # CSS variables: light + [data-theme="dark"]
    │   └── global.css
    └── test/
        └── setup.ts                # RTL + jest-dom, matchMedia mock
```

## Tech choices (locked by tech-spec)

- React 18, TypeScript strict, Vite, React Router v6, Axios, date-fns, vite-plugin-pwa, Vitest + RTL. `@dnd-kit` is deferred to the projects spec (not installed here to avoid unused deps).

## Environment & dev proxy

`vite.config.ts` dev server proxies `/api` → `VITE_API_URL` (default `http://localhost:3001`). The app always calls **relative** `/api/...` URLs. This keeps requests same-origin in dev so the browser sends and stores the httpOnly `tm_refresh` cookie (cross-origin cookies with `withCredentials` are brittle and the backend CORS origin is the Vite host). In production behind ingress, `/api` is routed to the backend Service, so relative URLs work unchanged.

`src/config/env.ts` exposes typed getters:
- `API_BASE` = `/api` (relative; proxy/ingress handles the rest)
- `GOOGLE_CLIENT_ID` = `import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''`
- `ENV` = `import.meta.env.VITE_ENV ?? 'development'`

## API client (`api/client.ts`)

Single axios instance:

```
baseURL: '/api'
withCredentials: true
headers: { 'Content-Type': 'application/json' }
```

**Token store:** module-scoped `let accessToken: string | null`, with `setAccessToken`/`getAccessToken`. Not exported to components directly — AuthContext owns lifecycle and calls these.

**Request interceptor:** if `accessToken` present, set `Authorization: Bearer <token>`.

**Response interceptor (401 → refresh → retry):**
- Skip handling when the failing request is `/auth/refresh` itself, or when `config._retry` is already set.
- On first 401: set `config._retry = true`, trigger a **single shared refresh** (see queue below). If refresh resolves, update token and replay the original request. If refresh rejects, propagate a normalized `ApiError` and notify AuthContext (via an injected `onAuthFailure` callback registered at provider mount) so it flips to `unauthenticated`.

**Single-flight refresh queue:** a module-level `refreshPromise: Promise<string> | null`. The first 401 sets it by calling `POST /api/auth/refresh`; concurrent 401s await the same promise. Cleared in `finally`. This satisfies Req 2.6 (at most one refresh, others queue).

**Envelope normalization:** a helper unwraps `{ success, data }` to `data` for callers, and converts `{ success:false, error }` (or a raw network failure) into a thrown typed `ApiError { code, message, details?, status }`. Network/no-response errors map to `code: 'NETWORK'`.

**Rationale for callback injection over import cycle:** the client must tell AuthContext about terminal auth failure without importing React state. AuthProvider registers `setAuthFailureHandler(fn)` on mount and clears it on unmount — keeps `api/` framework-agnostic and testable in isolation.

## Auth API wrappers (`api/auth.ts`)

Thin typed functions over the client, each returning unwrapped data or throwing `ApiError`:
- `register({ email, password, displayName?, timezone? }) -> { user, accessToken }`
- `login({ email, password }) -> { user, accessToken }`
- `google({ idToken }) -> { user, accessToken }`
- `refresh() -> { accessToken }`
- `me() -> { user }`
- `logout() -> void`

The exact response shape is confirmed against the backend authController during implementation (the backend returns the access token in the JSON body and sets the refresh cookie via `Set-Cookie`). `User` DTO fields consumed here: `id, email, displayName, avatarUrl, tier, settings (incl. timezone, theme-relevant prefs later), currencyBalance`.

## AuthContext (`contexts/AuthContext.tsx`)

State: `{ user: User | null, status: 'loading' | 'authenticated' | 'unauthenticated' }`.

**Bootstrap (on mount):** call `refresh()`; on success `setAccessToken`, then `me()`, set user, status `authenticated`. On failure status `unauthenticated`. While pending, status stays `loading` (Req 3.2, 3.3).

**Actions:**
- `loginWithPassword` / `registerWithPassword`: call wrapper, `setAccessToken(accessToken)`, set user, status `authenticated`.
- `loginWithGoogle(idToken)`: call `google()`, same success handling.
- `logout`: call `logout()` (ignore failure), `setAccessToken(null)`, clear user, status `unauthenticated`.
- `refreshProfile`: re-fetch `me()`.

**Terminal-failure wiring:** on mount, register `setAuthFailureHandler(() => { setAccessToken(null); set status unauthenticated })` so an interceptor refresh failure during normal use logs the user out (Req 3.6).

`useAuth()` throws outside provider (Req 3.7).

## Google sign-in (`hooks/useGoogleSignIn.ts`)

- If `GOOGLE_CLIENT_ID` is empty, hook reports `available: false` and renders nothing (Req 4.2).
- If present, lazy-load Google Identity Services script, initialize with the client id, and expose a way to trigger the flow that resolves to an ID token, which the Login page passes to `loginWithGoogle`.
- Backend `503` surfaces as an `ApiError` the Login page catches to show the friendly unavailable message while leaving email/password working (Req 4.4).

## Login page (`pages/Login.tsx`)

Layout top-to-bottom: Google button (when available) → divider → email/password form with a Login/Register toggle. **Login mode** shows email + password. **Register mode** additionally shows a **required display name** field (non-unique label; validated non-empty, max 255). Client-side validation before submit: email format, password ≥ 8 chars (matches backend), and display name required in Register mode; disabled + spinner while pending; backend errors mapped to friendly copy by `error.code` with a generic fallback. On success, `AuthContext` flips to authenticated and the router redirects to `/` (Req 5.3).

Single page with a Login/Register toggle rather than two routes, keeping the "Google first, then credentials" surface compact.

## Automatic timezone capture

A small `src/utils/timezone.ts` `detectTimezone(): string | undefined` wraps `Intl.DateTimeFormat().resolvedOptions().timeZone` (returns `undefined` on any falsy/throwing result). `AuthContext`'s `registerWithPassword`, `loginWithPassword`, and `loginWithGoogle` call it and include `timezone` in the request payload when defined (omit otherwise). This sets a new user's zone at signup and keeps a returning user's zone current on every login, with no timezone UI. The backend resolves/validates it defensively (invalid → UTC), so a bad value never breaks auth. An explicit timezone editor is deferred to the settings spec.

## Routing & protection (`App.tsx`, `components/layout/ProtectedRoute.tsx`)

React Router v6 tree:

```
<Routes>
  <Route path="/login" element={<RedirectIfAuthed><Login/></RedirectIfAuthed>} />
  <Route element={<ProtectedRoute/>}>          // guards + renders <AppShell/> with <Outlet/>
    <Route path="/"         element={<Placeholder title="Tasks"/>} />
    <Route path="/projects" element={<Placeholder title="Projects"/>} />
    <Route path="/profile"  element={<Placeholder title="Profile"/>} />
    <Route path="/settings" element={<Placeholder title="Settings"/>} />
  </Route>
  <Route path="*" element={<CatchAllRedirect/>} />
</Routes>
```

- `ProtectedRoute`: if `status==='loading'` render full-screen `Spinner`; if `unauthenticated` `<Navigate to="/login" replace/>`; else render `<AppShell/>` (which renders `<Outlet/>`).
- `RedirectIfAuthed`: authenticated → `<Navigate to="/" replace/>`.
- `CatchAllRedirect`: authenticated → `/`, else `/login`.

## App shell (`components/layout/AppShell.tsx`)

`<Header/>` on top, `<main>` renders `<Outlet/>`, `<BottomNav/>` fixed to the bottom, `<Toast/>` overlay mounted once at shell level.

- **BottomNav:** five items in order Tasks, Projects, **Add (+)**, Profile, Settings. Uses `NavLink` for active state (Req 6.3). The center Add is a visually prominent button that is disabled/no-op this spec (Req 6.2). Fixed position, safe-area padding, thumb-zone sizing, ARIA labels + visible focus.
- **Header:** app name + an account **dropdown menu** (avatar/display-name trigger) whose menu contains Logout, which calls `useAuth().logout()`. Two-step (open → Logout) so logout can't fire on a stray tap. Menu is keyboard-navigable, closes on outside click / Escape, and uses `aria-expanded` + `role="menu"`/`menuitem`. Room to grow later (e.g. account/settings shortcuts).

## Theming (`ThemeProvider`, `SettingsContext`, `styles/tokens.css`)

- `tokens.css` defines `:root` light variables and `[data-theme="dark"]` overrides (background, surface, text, primary, danger, border, focus-ring), chosen for WCAG AA contrast on normal text.
- `SettingsContext` holds `theme: 'light'|'dark'|'system'`, persisted to `localStorage` key `tm_theme` (theme preference is non-sensitive; token is not). Default `system`.
- `ThemeProvider` computes the effective theme: for `system`, read `matchMedia('(prefers-color-scheme: dark)')` and subscribe to changes; set `document.documentElement.dataset.theme` accordingly.
- **Pre-paint:** a tiny inline script in `index.html` reads `tm_theme` and sets `data-theme` before React mounts to avoid a flash (Req 7.5). React then takes over.

## Toast & error boundary

- `ToastContext` exposes `showToast(message, opts?)`; `Toast.tsx` renders the queue as an overlay with `role="status"`/`aria-live="polite"`. Minimal now; the achievements/profile spec will extend it with celebration variants (Req 8.2).
- A class-based `ErrorBoundary` wraps the routed tree and renders a friendly fallback with a reload action (Req 8.3).

## Shared primitives (`common/`)

- `Button` (variants: primary/secondary/ghost; `loading` shows Spinner + disables), `Input` (label association, error text, `aria-invalid`), `Spinner` (`role="status"`, accessible label). All keyboard-accessible with visible focus (Req 8.1).

## Testing strategy (Vitest + RTL)

`src/test/setup.ts` registers jest-dom and mocks `matchMedia` (jsdom lacks it — needed by ThemeProvider). Planned tests:

1. **api/client** — 401 triggers exactly one refresh then retries and succeeds; refresh failure clears token + invokes auth-failure handler; concurrent 401s share a single refresh (single-flight); envelope error → typed `ApiError`. (axios mocked via a mock adapter or `vi.mock`.)
2. **AuthContext** — bootstrap authenticated path (refresh+me), bootstrap unauthenticated path (refresh rejects), login success sets user, logout clears state even when logout call rejects.
3. **Login** — Google hidden when `VITE_GOOGLE_CLIENT_ID` empty; validation blocks submit on bad email/short password; failed login shows friendly error; success triggers redirect (assert navigation via a test router).
4. **ProtectedRoute / routing** — unauthenticated hitting `/` redirects to `/login`; authenticated hitting `/login` redirects to `/`; loading shows spinner (no Login flash).
5. **BottomNav** — renders five slots in order, marks active item from route, center Add present.
6. **ThemeProvider / SettingsContext** — system theme follows mocked `matchMedia`; explicit selection sets `data-theme` and persists to `localStorage`.

Target: meaningful coverage of the token/refresh logic and auth/routing state machine (the highest-risk parts), not exhaustive DOM snapshots.

## Key design decisions (call out for review)

- **DD-1 Same-origin via dev proxy** rather than CORS + cross-origin cookie. Simpler, matches prod ingress, avoids SameSite/withCredentials pitfalls. App uses relative `/api`.
- **DD-2 Access token in memory + module-scoped store** owned by AuthContext; refresh cookie is httpOnly and never touched by JS (tech-spec §6.4).
- **DD-3 Single-flight refresh queue** so a burst of 401s triggers one refresh (Req 2.6).
- **DD-4 Interceptor→AuthContext via injected callback** to avoid a React↔api import cycle and keep `api/` unit-testable.
- **DD-5 Theme persisted in localStorage + inline pre-paint script**; only the non-sensitive theme preference is persisted, never the token.
- **DD-6 Placeholder pages** fill protected routes so the shell/routing is fully testable now; later specs replace the bodies without touching routing.
- **DD-7 `@dnd-kit` not installed yet** — deferred to the projects spec to avoid unused dependencies.

## Open questions for reviewer

1. ~~Registration fields / timezone~~ — RESOLVED: Register requires email + password + display name (non-unique); timezone is auto-detected from the browser and sent on register/login/google with no UI.
2. ~~Header account affordance~~ — RESOLVED: account dropdown menu (avatar → Logout), two-step so logout can't fire accidentally.
3. ~~PWA icons~~ — RESOLVED: placeholder icon set now; real branding in a later polish pass.
