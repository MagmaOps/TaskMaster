# Frontend App-Shell + Auth — Tasks

- [ ] 1. Scaffold the Vite + React 18 + TS PWA project
  - Create `task-master-front/` with Vite react-ts template structure: `package.json`, `tsconfig.json` (strict), `index.html`, `src/main.tsx`, `src/App.tsx`, `vite-env.d.ts`.
  - Add runtime deps (`react`, `react-dom`, `react-router-dom`, `axios`, `date-fns`) and dev deps (`vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/*`, `jsdom`, `vite-plugin-pwa`, `eslint`, `prettier`).
  - Define scripts: `dev`, `build`, `preview`, `test`, `test:coverage`, `lint`, `format`, `typecheck`.
  - Add `.env.example`, `.env.development`, `.env.production`; gitignore `.env.local`.
  - _Requirements: 1.1, 1.2, 1.3, 1.7_

- [ ] 2. Configure Vite (dev proxy, PWA, Vitest) and env access
  - `vite.config.ts`: react plugin, `vite-plugin-pwa` (manifest: name, theme color, icons; autoUpdate), dev server proxy `/api` → `VITE_API_URL` (default `http://localhost:3001`), and Vitest config (jsdom env, setup file, globals).
  - `src/test/setup.ts`: import jest-dom, mock `matchMedia`.
  - `src/config/env.ts`: typed getters `API_BASE='/api'`, `GOOGLE_CLIENT_ID`, `ENV`.
  - Add placeholder PWA icons under `public/icons/`.
  - Verify `npm run typecheck` and `npm test` (empty/passing) run clean.
  - _Requirements: 1.4, 1.5, 1.6, 1.8_

- [ ] 3. Build the API client with token handling and refresh queue
  - `src/api/types.ts`: `ApiSuccess<T>`, `ApiErrorEnvelope`, `ApiError` class (`code`, `message`, `details?`, `status`), `User` DTO.
  - `src/api/client.ts`: axios instance (`baseURL:'/api'`, `withCredentials:true`); module token store (`get/setAccessToken`); request interceptor attaches Bearer; response interceptor does single retry on 401 via single-flight `refreshPromise`; `setAuthFailureHandler` hook; envelope unwrap + `ApiError` normalization (incl. `NETWORK`).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [ ] 4. Unit-test the API client
  - Tests: single refresh+retry on 401; refresh failure clears token and calls auth-failure handler; concurrent 401s share one refresh; error envelope → typed `ApiError`; refresh endpoint itself not intercepted.
  - _Requirements: 2.4, 2.5, 2.6, 2.7_

- [ ] 5. Implement auth API wrappers + timezone util
  - `src/api/auth.ts`: `register` (email, password, displayName, timezone?), `login` (email, password, timezone?), `google` (idToken, timezone?), `refresh`, `me`, `logout` — typed, unwrapped, throwing `ApiError`. Confirm shapes against backend `authController`/`authRoutes` (password min 8; displayName optional server-side).
  - `src/utils/timezone.ts`: `detectTimezone()` wrapping `Intl.DateTimeFormat().resolvedOptions().timeZone`, returns `undefined` on falsy/throw.
  - _Requirements: 3.1, 4.3, 9.1_

- [ ] 6. Implement AuthContext and session lifecycle
  - `src/contexts/AuthContext.tsx`: state machine (`loading`/`authenticated`/`unauthenticated`); mount bootstrap (refresh → me); actions `loginWithPassword`, `registerWithPassword`, `loginWithGoogle`, `logout`, `refreshProfile`; each auth action includes `detectTimezone()` as `timezone` when defined; register `setAuthFailureHandler` on mount; `useAuth` throws outside provider.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.2, 9.3_

- [ ] 7. Unit-test AuthContext
  - Tests: bootstrap authenticated (refresh+me), bootstrap unauthenticated (refresh rejects, no Login flash via loading), login success sets user, logout clears state even when logout call rejects.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 8. Implement SettingsContext + ThemeProvider + tokens
  - `src/styles/tokens.css` (light `:root` + `[data-theme="dark"]`, AA-contrast) and `global.css`.
  - `src/contexts/SettingsContext.tsx`: `theme` pref persisted to `localStorage` `tm_theme`, default `system`.
  - `src/components/layout/ThemeProvider.tsx`: compute effective theme, subscribe to `matchMedia` for `system`, set `document.documentElement.dataset.theme`.
  - Inline pre-paint theme script in `index.html`.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 9. Unit-test theming
  - Tests: `system` follows mocked `matchMedia`; explicit selection sets `data-theme` and persists; default is `system`.
  - _Requirements: 7.2, 7.3, 7.4_

- [ ] 10. Build shared primitives, Toast, and ErrorBoundary
  - `common/Button.tsx` (variants + `loading`), `common/Input.tsx` (label + `aria-invalid` + error), `common/Spinner.tsx` (`role="status"`).
  - `contexts/ToastContext.tsx` (`showToast`) + `components/layout/Toast.tsx` (`aria-live` overlay).
  - `ErrorBoundary` wrapping the routed tree with a friendly fallback.
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 11. Implement Google sign-in hook
  - `src/hooks/useGoogleSignIn.ts`: `available=false` when `GOOGLE_CLIENT_ID` empty; else lazy-load GIS, init, expose trigger resolving to an ID token.
  - _Requirements: 4.2, 4.3_

- [ ] 12. Build the Login page
  - `src/pages/Login.tsx`: Google option first (hidden when unavailable), divider, email/password form with Login/Register toggle; Register mode adds a required display name field (non-empty, max 255); client validation (email format, password ≥ 8, display name required in Register); loading/disabled submit; friendly error mapping incl. `503` Google-unavailable; redirect to `/` on success; semantic labels + keyboard nav.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [ ] 13. Unit-test the Login page
  - Tests: Google hidden when client id empty; validation blocks bad email/short password/empty display name in Register; failed login shows friendly error; success navigates to `/`; register/login send detected `timezone` in payload.
  - _Requirements: 4.2, 4.5, 4.6, 4.8, 9.2_

- [ ] 14. Implement routing, ProtectedRoute, and redirects
  - `App.tsx` route table; `ProtectedRoute` (loading→Spinner, unauth→`/login`, else `AppShell` + `Outlet`); `RedirectIfAuthed`; `CatchAllRedirect`; `pages/Placeholder.tsx` for Tasks/Projects/Profile/Settings.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 15. Unit-test routing & protection
  - Tests: unauth `/`→`/login`; auth `/login`→`/`; loading shows spinner (no Login flash); unknown route redirect.
  - _Requirements: 5.2, 5.3, 5.4_

- [ ] 16. Build the app-shell layout (Header + BottomNav)
  - `components/layout/AppShell.tsx` (Header + `Outlet` + BottomNav + Toast); `Header.tsx` (app name + account dropdown menu: avatar/name trigger → Logout; two-step, closes on outside click / Escape, `aria-expanded` + `role="menu"`/`menuitem`, keyboard nav); `BottomNav.tsx` (five slots in order, `NavLink` active state, prominent no-op center Add, ARIA + focus, responsive to 320px, thumb-zone).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 17. Unit-test the app shell
  - Tests: BottomNav renders five slots in order; active item reflects route; center Add present; account menu is closed by default, opens on trigger, and Logout (inside the open menu) calls `logout`; menu closes on Escape.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 18. Wire providers in main.tsx and finalize verification
  - `main.tsx`: nest `SettingsContext` → `ThemeProvider` → `AuthProvider` → `ToastContext` → `ErrorBoundary` → `RouterProvider`.
  - Run `npm run typecheck`, `npm test`, `npm run lint` — all green.
  - Manual smoke: `npm run dev` with backend up — register/login, land in shell, toggle theme, logout, refresh-persists-session; confirm Google button hidden when `VITE_GOOGLE_CLIENT_ID` empty.
  - _Requirements: 1.4, 1.5, all_
