# TaskMaster — Session Handoff

## Paste this to the new Kiro session

> I am continuing a rebuild of TaskMaster (weight-based task-management SaaS, self-hosted on k3s via ArgoCD). Read these first, in order, as ground truth: `docs/BUILD-STATE.md` (backend handoff — process, environment gotchas, DB schema, API surface), `docs/prd.md` and `docs/technical-specification.md` (product + technical vision), and the specs under `.kiro/specs/`.
>
> Working agreement: one logical abstraction per spec; for each feature write spec -> I review and confirm -> then implement -> verify. No leftover/waste files. Autopilot is on: create/edit code without asking, but keep the spec-confirmation gate.
>
> Verify health before working. Backend: `docker compose up -d` then `cd task-master-server && npm test` (**184 tests / 27 suites**) + `npm run typecheck` clean. Frontend: `cd task-master-front && npm test` (**97 tests / 19 suites**), `npm run typecheck`, `npm run lint`, `npm run build` all clean.
>
> The backend is feature-complete. The frontend (`task-master-front/`, React 18 + TS + Vite PWA) has **3 of 4 planned specs done**: app-shell+auth, task-views, projects-management (+ a task-project tag-input enhancement). **Next up is the LAST frontend spec: profile + settings** — Profile (achievements gallery, streaks, economy balance, per-project analytics, celebration-toast surface already exists) and Settings (theme editor incl. dark mode, focus-mode toggle, achievement-toasts toggle, timezone, premium weight-visibility toggle). Write its requirements + design for my review first. After that: Dockerfiles + k8s/ArgoCD manifests (`k8s/`), images to Docker Hub `magmakomer`.
>
> Trust the code and tests on disk over any memory.

## Current state (as of this handoff)

- **Backend:** feature-complete, committed. 184 tests / 27 suites green; typecheck clean. API surface unchanged this session (frontend only consumed it).
- **Frontend (`task-master-front/`):** app-shell+auth is **committed** (`159c8c5`). Task-views, projects-management, and the task-project tag-input (+ two follow-up bug fixes) are **working-tree only, not yet committed** — see the commit note below. All green: 97 tests / 19 suites, typecheck + lint clean, `npm run build` succeeds (main bundle ~109 KB gzip, under the 500 KB budget).
- **k8s/ArgoCD:** not started.

## Frontend specs — status

Located in `.kiro/specs/`. Each was written -> user-confirmed -> built -> verified (typecheck/tests/lint/build) -> live-smoked through the Vite dev proxy.

1. **frontend-app-shell-auth** — DONE & COMMITTED. Vite+React18+TS PWA scaffold; API client (in-memory access token, `withCredentials`, single-flight 401->refresh->retry, envelope->`ApiError`); `AuthContext` (silent-refresh bootstrap, login/register/google/logout, auto browser-timezone on auth calls); Login (Google-first hidden when `VITE_GOOGLE_CLIENT_ID` empty, then email/password with Login/Register toggle, required display name on register, password >= 8); routing + `ProtectedRoute`; app shell (`Header` with two-step account-dropdown logout, five-slot `BottomNav`); theming (light/dark/system via CSS vars, `tm_theme`, pre-paint anti-flash); `Button`/`Input`/`Spinner`, `Toast`, `ErrorBoundary`.
2. **frontend-task-views** — DONE (uncommitted). `TaskContext` (server owns weight+order; re-fetch after mutations); `TaskList` ("What's Next?" top card + list); Quick-Add (center + button); Action modal (Complete/Later/Modify/Archive/Delete); Deferral modal (later_today/tomorrow/sometime_later); `ProjectSelector` with **Focus** as the first single-select pill (icon at `public/icons/focus.png`); celebration toasts gated by `achievement_toasts_enabled`. Accessible `Modal` primitive.
3. **frontend-projects-management** — DONE (uncommitted). `ProjectContext` (re-fetch after create/edit/delete; optimistic-then-reconcile reorder); `ProjectManagement` page (Unassigned pinned first, "Default" badge, no edit/delete/drag; real projects below; New disabled at 20); create/edit modal (name + lightweight color: 8-swatch palette + "No color", swatch shown in list only); delete dialog (explains tasks are kept -> Unassigned); `@dnd-kit` drag reorder (pointer+keyboard, `computeReorder` pure helper tested since jsdom lacks layout for dnd keyboard sensor).
4. **frontend-task-project-tag-input** — DONE (uncommitted). Replaced the task form's project checkbox list with `ProjectTagInput`: case-insensitive autocomplete over existing projects; **Enter or comma** confirms a badge (existing name any-case reuses the real project; new name -> pending); **Backspace-on-empty** removes last (no × button); badges show `● Name` color circle; "Unassigned" rejected inline; **create-on-save** (`POST /api/projects` with a frontend-random palette color, then task saves with real ids); **409 reconcile** by re-fetch + case-insensitive name match. Shared palette extracted to `utils/projectColor.ts`.

5. **frontend-profile-settings** — NOT STARTED (the next/last frontend spec).

## Two follow-up fixes this session (in the uncommitted work)

- **Modify-on-Unassigned bug:** `TaskForm` used to seed `projectIds` from `initialTask.projects`, which includes the Unassigned **default** project; sending the default id back is rejected by the backend (`assertOwned`) -> "One or more project ids are invalid". Fixed by seeding chips from **real projects only** (cross-referenced against the projects list to drop `isDefault`). Regression-tested.
- **Stale-state after project mutations:** the Tasks page kept its own local project list (one-time fetch), so newly created projects didn't appear in the selector / tag-input autocomplete, and deleted projects still showed on task cards. Fixed by (a) `TaskList` now reads projects from `ProjectContext` (single source; `createProject` refreshes it), and (b) `ProjectManagement` calls `useTasks().loadTasks()` after delete / edit / reorder so task cards aren't stale. Both regression-tested.

## Frontend architecture notes (for the next session)

- **Providers (in `AppShell`, authenticated-only):** `ProjectProvider` > `TaskProvider` wrap the shell; `SettingsProvider`/`ThemeProvider`/`AuthProvider`/`ToastProvider`/`ErrorBoundary` are in `main.tsx`. Mount profile/settings data providers similarly (authenticated-only) or reuse existing contexts.
- **Contexts are the single source of truth.** When one context's mutation affects another's view, wire an explicit reload at the page level (see the stale-state fix). Don't keep parallel local copies of server lists.
- **Server owns weight/order/counts** — re-fetch after mutations rather than optimistic edits (except reorder, which is optimistic-then-reconcile).
- **User settings** live on the authenticated user (`useAuth().user.settings`): `theme`, `timezone`, `focus_mode_enabled`, `achievement_toasts_enabled`, `weight_visibility_enabled`, `project_priority_enabled`. The profile/settings spec owns the EDITORS for these. Backend: `PATCH /api/auth/me` currently accepts `timezone`; **check whether it accepts the other settings keys** before designing the settings editors (it may need a small backend addition, or a broader settings PATCH — confirm from `authController`/`authRoutes` and flag to the user if a backend change is required).
- **API wrappers exist** for auth, tasks, projects. Profile/settings will need wrappers for `GET /api/achievements`, `GET /api/streaks`, `GET /api/economy`, `GET /api/analytics/projects`, and a settings update path.
- **Dark mode already works** (app-shell spec) — the Settings page just needs a theme selector that calls `useSettings().setTheme`.
- **PWA icons + focus icon are placeholders** (generated by `scripts/make-*.mjs`) — real branding is a later polish pass.

## Environment gotchas (also in BUILD-STATE)

- **Windows/MINGW shell:** heredocs and long multi-statement/`node -e` one-liners get scrambled or mis-capture output (several smoke-test "failures" this session were shell artifacts, not code bugs — e.g. `$(...)` capturing "stdout is not a tty"). Prefer the editor tools for file writes; keep shell commands simple; write JSON via editor, not heredoc. `/tmp` maps to `C:\Users\<user>\AppData\Local\Temp`.
- **Dependency audit:** `npm audit` in the frontend reports vitest/vite **dev-server** advisories (moderate→critical). They affect the dev toolchain only, not the shipped bundle; the only fixes are major bumps (vitest 5, vite 7, react-router 7) that would break the locked stack. Deferred to a deliberate upgrade pass — do NOT `audit fix --force`.
- **dnd-kit + jsdom:** the keyboard sensor needs layout jsdom doesn't provide; test reorder via the pure `computeReorder` helper, not simulated key events.
- **pg DATE/timezone gotchas + fast-check date generators:** see BUILD-STATE (backend only; unchanged this session).

## Local run / verify

- Backend + test Postgres: `docker compose up -d`; backend `cd task-master-server && npm run dev` (port 3001).
- Frontend: `cd task-master-front && npm run dev` (port 5173; Vite proxies `/api` -> 3001 so the httpOnly `tm_refresh` cookie is same-origin).
- Google button is hidden until `VITE_GOOGLE_CLIENT_ID` is set (expected).
- Smoke-test data goes into `taskmaster_dev`; clean up test users with `docker exec taskmaster-postgres psql -U postgres -d taskmaster_dev -c "DELETE FROM users WHERE email = '...';"`.

## Uncommitted changes in this session (commit these)

All frontend, all verified green. Logical unit: **the task-views + projects-management + tag-input features and their two follow-up fixes.** Files include `task-master-front/src/{contexts,pages,components/{tasks,projects,layout,common},api,utils}`, `public/icons/focus.png`, `scripts/make-focus-icon.mjs`, `package.json`/`package-lock.json` (added `@dnd-kit/*`, `axios-mock-adapter`), edits to `App.tsx`/`AppShell.tsx`/`BottomNav.tsx`, and the three new spec dirs under `.kiro/specs/`.

### Suggested commit message (< 100 chars)

```
feat(frontend): task views, projects management, and inline project tag-input
```

Stage the `task-master-front/` changes + the three `.kiro/specs/frontend-*` dirs (avoid `git add -A`). We are on `main`; prior commit `159c8c5` was app-shell + auth.

## Remaining work

1. **frontend-profile-settings** (last frontend spec) — Profile (achievements/streaks/economy/analytics) + Settings (theme, focus mode, toast toggle, timezone, premium weight visibility). Confirm the backend settings-update contract first.
2. **Dockerfiles + k8s/ArgoCD** (`k8s/` per tech-spec §2/§8) — backend + frontend images to `magmakomer`, Postgres StatefulSet+PVC, migrate Job, Traefik ingress, Sealed Secrets, ArgoCD app-of-apps, overlays/local then overlays/prod (domain + cert-manager).
