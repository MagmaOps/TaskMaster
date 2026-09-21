# TaskMaster — Build State & Handoff

**Purpose:** Ground-truth handoff for continuing the rebuild in a fresh session. Read this + the specs in `.kiro/specs/` before doing anything. When in doubt, trust the code and tests on disk over any summary.

**Last verified:** 118 tests passing across 15 suites; TypeScript typecheck clean.

---

## What we're building

A rebuilt **TaskMaster** — a weight-based task-management SaaS (removes decision fatigue by auto-prioritizing tasks; "What's Next?"). Self-hosted on the owner's **k3s** cluster via **ArgoCD** (GitOps), images pushed to Docker Hub namespace **`magmakomer`** (`magmakomer/taskmaster-backend`, `magmakomer/taskmaster-frontend`). Multi-user SaaS with free/premium tiers + virtual economy. Local-first testing now; public domain + TLS added later.

Full product vision: `docs/prd.md`. Full technical spec: `docs/technical-specification.md`.

## Stack decisions (locked)

- **Backend:** Node 18+, Express, **TypeScript** (strict), `pg` (raw parameterized SQL, no ORM), node-pg-migrate. Layered: routes → controller → service → repository. Located in `task-master-server/`. Property-based tests use `fast-check` (devDependency only; runtime deps unchanged).
- **Frontend (NOT STARTED):** React 18 + **TypeScript** + **Vite** PWA, `@dnd-kit` (not react-beautiful-dnd), `vite-plugin-pwa`, Vitest. Dark mode in scope. Located in `task-master-front/` (currently empty/deleted — needs greenfield build).
- **Auth:** Google OAuth (primary, first in UI) + email/password. JWT access (15m) + rotating refresh (30d, httpOnly cookie `tm_refresh`, stored as SHA-256 hash). Google returns 503 until `GOOGLE_CLIENT_ID` is set.
- **Monorepo** (single git repo, front + back + k8s). Git repo initialized at root but **nothing committed yet**.
- **Secrets:** Sealed Secrets for k8s (later).

## Working process (IMPORTANT — follow this)

1. **One logical abstraction per spec.** Each feature = its own `.kiro/specs/<name>/` with requirements.md + design.md + tasks.md.
2. **Write spec → USER REVIEWS & CONFIRMS → then implement → verify.** Do NOT implement before the user confirms the spec. This gate matters to the user.
3. After building: run `npm run typecheck` and `npm test`, both must be green. Do a brief live smoke test when useful.
4. **No waste files.** Delete superseded/outdated files (user is explicit about this).
5. Prefer dedicated tools; keep the user informed; flag schema-destructive changes.

## Environment / gotchas (learned the hard way)

- **OS:** Windows, bash shell (MINGW). **MINGW truncates multi-statement command output and aborts scripts on a non-zero mid-pipe.** Run one command per call, or write output to a `/tmp` file and `cat` it. Avoid `set -e` multi-step curl scripts.
- **`pg` returns DATE and TIMESTAMPTZ columns as JS `Date` objects, not strings.** Normalize (e.g. `normalizeDate`/`normalizeTime` in taskService) before calling `.split()` etc. This caused a real bug.
- **`express-rate-limit` keeps a timer that hangs Jest.** The auth limiter is skipped when `NODE_ENV=test` (`skip: () => process.env.NODE_ENV === 'test'`).
- **node-pg-migrate v7 needs `ts-node`** (installed) — NOT tsx — to run `.ts` migrations. The migrate scripts pass flags: `-m src/database/migrations -j ts --tsconfig tsconfig.json --envPath .env` (or `.env.test`).
- **`npm test`** uses `cross-env NODE_ENV=test`. Jest globalSetup runs migrations on the test DB; setupAfterEnv truncates tables between tests and loads `.env.test`.
- Migrations use timestamp-style names starting `1000000000000`.
- **`pg` parses a DATE column into a JS `Date` at the SERVER-LOCAL midnight of the stored calendar day** (not UTC midnight). So to recover the stored 'YYYY-MM-DD' you MUST use LOCAL getters (getFullYear/getMonth/getDate), NOT UTC getters — UTC getters shift the date back a day whenever the server runs ahead of UTC (BST/CEST). This bit `streakRepository.normalizeDate` (fixed). Contrast: `zonedNow` in userTime builds a Date from Intl wall-clock parts, so its `getTime()` is NOT the true instant — never use `zonedNow` for elapsed-time/age math.
- **Weight age must clamp at 0.** `ageInDays = Math.max(0, Math.floor((now - createdAt)/DAY))`. A just-created task can have `created_at` (DB `now()` at insert) a few ms AHEAD of the later-captured `now`, and `Math.floor` of a tiny negative → -1 → base `(ageInDays+1)*mult = 0`, zeroing the whole weight. Surfaced only under full-suite load; clamped in `weight.ts`.
- **Timezone is per-user, stored in `users.settings` JSONB under `timezone` (IANA name, default 'UTC').** Server "today"/"now" for weight/defer/streaks must be computed in the user's zone via `src/services/time/userTime.ts` — never server-local. All age/due-proximity math uses the TRUE instant; only calendar-day comparisons (`localToday`) use the zoned date.

## Local infrastructure

`docker-compose.yml` at repo root runs two Postgres 16 containers (Docker Desktop):
- **postgres** — dev, port **5432**, named volume `taskmaster_pgdata`. DB `taskmaster_dev`, user `postgres`, pass `dev_password`.
- **postgres-test** — test, port **5433**, **tmpfs** (ephemeral). DB `taskmaster_test`, pass `test_password`.

Start: `docker compose up -d`. Backend `.env` points at 5432; `.env.test` at 5433.
Run backend locally: `cd task-master-server && npm run dev` (tsx watch, port 3001).

## Database schema (5 migrations applied to dev)

- `1000000000000_init_users_and_auth`: **users** (id, email unique, password_hash NULLABLE, display_name, avatar_url, tier check(free|premium) default free, currency_balance bigint default 0, settings jsonb — now includes a `timezone` key (IANA, default 'UTC'), timestamps), **oauth_accounts** (unique (provider,provider_user_id)), **refresh_tokens** (token_hash unique, expires_at, revoked_at, user_agent).
- `1000000000001_init_tasks_projects_gamification`: **tasks** (user_id, subject, priority check(high|medium|low), due_date, due_time, is_repeatable, repeat_pattern jsonb, timestamps, completed_at, archived_at; partial index on active), **projects** (name, priority_order check 1-20, color; unique (user_id,name), unique (user_id,priority_order)), **task_projects** (composite PK), **deferrals** (option_chosen check), **achievements** (unique (user_id,type,COALESCE(data->>'task_id',''))), **streaks** (user_id, current/longest_streak, last_completed_date, `series_id uuid` nullable — see migration 4; unique (user_id, COALESCE(series_id, zero-uuid))).
- `1000000000002_projects_priority_deferrable`: replaced plain unique INDEX `uq_projects_user_priority` with a **DEFERRABLE INITIALLY DEFERRED** unique CONSTRAINT so multi-row reorders don't collide mid-transaction (the CHECK 1-20 forbids negative temp ranks, so deferred is the fix).
- `1000000000003_completion_support`: `tasks.weight_at_completion integer` (nullable), `tasks.repeat_series_id uuid` (nullable) + partial index. `repeat_series_id` is a **standalone fresh UUID per repeatable series** (NOT a task id), set in `create` via `CASE WHEN $repeatable THEN gen_random_uuid() ELSE NULL END`.
- `1000000000004_streaks_series_key`: dropped `streaks.task_id` (+ its FK and old unique index); added standalone `series_id uuid` (nullable, no FK); re-keyed unique index on `(user_id, COALESCE(series_id, zero-uuid))`. Daily streak = `series_id IS NULL`; per-series = `series_id = repeat_series_id`. Reversible down restores `task_id`.

## Features DONE & verified (backend)

### auth-system (`.kiro/specs/auth-system/`)
Email/password register+login, Google OAuth (`POST /api/auth/google`, 503 if unconfigured, account-linking by verified email), refresh rotation (`/api/auth/refresh` revokes old + issues new), `/api/auth/logout`, `/api/auth/me`. Rate limit 10/min on register/login/google (skipped in test). Files: config, validateEnv, database/pool, utils/errors, types/index, services/auth/{tokenService,passwordService,googleVerifier,authService}, repositories/{userRepository,refreshTokenRepository}, middleware/{authMiddleware,errorHandler,validate}, controllers/authController, routes/authRoutes, app.ts, server.ts.

### task-management (`.kiro/specs/task-management/`)
CRUD + complete + defer + archive at `/api/tasks`. **Pure weight algorithm** `src/services/tasks/weight.ts`: `base=(ageInDays+1)*priority(high3/med2/low1)`; **continuous hours-based due proximity** (due moment = due_date+due_time, or 23:59:59 if no time; overdue `ceil(|h|/24)*10`; within 168h `(7 - h/24)*(35/7)`; earlier due_time outweighs later same day); project `*(1+projectMultiplier)` (mult=1.0 single, else `clamp(1-(order-1)/(total-1),0,1)`, uses lowest-order project); `+5*deferralCount`; `*2` if repeatable due today; round. Injectable `now`. `calculateWeightBreakdown` returned only for premium + weight_visibility_enabled. Defer: later_today→due today, tomorrow→due+1, sometime_later→priority down one level + clear due + record deferral. Files: types/task, repositories/{taskRepository,deferralRepository}, services/tasks/{weight,taskService}, controllers/taskController, routes/taskRoutes.

### projects-management (`.kiro/specs/projects-management/`)
CRUD + reorder + task counts at `/api/projects`. Max 20, case-insensitive name uniqueness. Reorder takes the FULL new ordered id list (400 if not exactly the user's set), single-pass under the deferrable constraint. Delete keeps tasks (only task_projects associations cascade) and closes the priority_order gap. `PUT /reorder` declared BEFORE `/:id`. Files: types/project, repositories/projectRepository (this SUPERSEDED and deleted the temporary projectReadRepository), services/projects/projectService, controllers/projectController, routes/projectRoutes.

### completion-events (`.kiro/specs/completion-events/`) — foundational
`src/services/completion/completionEvents.ts`: multi-listener **dispatcher** replacing the old single `setCompletionHook`. `CompletionEvent { userId, task:TaskWithMeta, weightAtCompletion, unlocked:UnlockedAchievement[] }`, `registerCompletionListener(fn)`, `clearCompletionListeners()`, `emitTaskCompleted(event)` (invokes listeners in order, try/catch each — a throwing listener is logged and NEVER breaks completion or the others). `taskService.completeTask` persists `weight_at_completion` and emits the event, returns `unlocked` in the response.

### economy (`.kiro/specs/economy/`)
Currency earned on completion = `round(weightAtCompletion × earnRate)` (free 1.0, premium `config.economy.premiumEarnRate` default 1.5), clamped ≥0. `GET /api/economy` → `{ balance, earnRate, tier }`. Files: config addition, repositories/economyRepository (addCurrency GREATEST clamp, getBalance), services/economy/economyService (earnRateForTier, onTaskCompleted, getEconomy), controllers/economyController, routes/economyRoutes.
**Listener registration pattern:** `src/services/completion/registerListeners.ts` `registerAllListeners()` (once-per-process guard `let registered=false`) is called inside `createApp()`. Add future listeners HERE in order. Integration suites that assert listener behavior reset in `beforeAll`: `clearCompletionListeners()` then re-register the specific listener(s) they need (economy suite does this) to avoid cross-suite registry-state flakiness.

### user-timezone (`.kiro/specs/user-timezone/`)
Per-user IANA timezone stored in `users.settings.timezone` (default 'UTC'; no migration — settings was already JSONB). Pure utility `src/services/time/userTime.ts`: `resolveTimezone` (validates via Intl, invalid/empty/>64chars → 'UTC'), `isValidTimezone` (express-validator predicate), `localCalendarDate(tz, now?)` → 'YYYY-MM-DD' via Intl formatToParts, `zonedNow(tz, now?)` (zoned wall-clock Date — NOT a true instant, see gotchas), `nextCalendarDate(dateStr)` (DST-safe UTC-noon +1 day). `toPublicUser` coalesces missing/invalid timezone → 'UTC' at read time (no backfill). `PATCH /api/auth/me { timezone }` (400 on invalid, preserves other settings keys); register/login/google accept an optional timezone (silent UTC fallback, never 400). weight.ts: repeatable-due-today now compares task dueDate against the user's zoned localToday string; age/due-proximity use the true instant. taskService.loadUserWeightContext resolves the user's zone once and passes now(true instant)+localToday into WeightInput; deferTask later_today/tomorrow use localCalendarDate/nextCalendarDate in the user's zone. Property tests via fast-check (8 correctness properties). Files: services/time/userTime(.ts+.test.ts), edits to types/index (UserSettings.timezone + DEFAULT_USER_SETTINGS + toPublicUser coalesce), userRepository (updateSettings + timezone create-params), authService (updateTimezone + timezone on register/google), authController (updateTimezone + threading), authRoutes (PATCH /me + optional timezone validators), weight.ts (localToday + age clamp), taskService (zone threading + defer).

### streaks (`.kiro/specs/streaks/`)
Completion listener maintaining a daily streak (consecutive user-local days with >=1 completion) + per-repeatable-series streaks (keyed by repeat_series_id). Consumes user-timezone: "today" = user's Local_Calendar_Date. Pure `src/services/streaks/streakMath.ts` `advanceStreak(prev, today)` (first / same-day no-op / yesterday+1 / gap reset), DST-safe via nextCalendarDate, timezone-agnostic string compares. `streakRepository`: getByKey, upsert (ON CONFLICT on the expression index), listForUser (daily + per-series with representative subject label via LEFT JOIN LATERAL on max(created_at)). `streakService`: applyForCompletion, onTaskCompleted (derives user-local today, advances daily + optional per-series, stashes results on event.streaks), getStreaks. `CompletionEvent` extended with optional `streaks?: { daily: number; series?: number }` side-channel. Streak listener registered in registerAllListeners BEFORE achievements (documented — achievements reads event.streaks). `GET /api/streaks` → `{ success, data: { daily, series } }`. Integration suite resets listeners to the streak listener (determinism pattern). Files: migration 1000000000004, services/streaks/{streakMath(.ts+.test.ts), streakService.ts}, repositories/streakRepository.ts, controllers/streaksController.ts, routes/streaksRoutes(.ts+.test.ts), edits to completionEvents.ts (side-channel), registerListeners.ts (ordering), app.ts (mount).

## NEXT UP: achievements (`.kiro/specs/achievements/` — SPEC WRITTEN & CONFIRMED, task list + build remain)

Completion listener that unlocks milestones and appends to `event.unlocked` (celebrated in the complete response); reads the just-updated `event.streaks` (registered AFTER the streak listener). **requirements.md and design.md are written and user-confirmed. Only tasks.md + implementation + verify remain.** Resume by generating the task list, then build → verify (keep 118+ tests green).

Types & triggers (all idempotent via `INSERT ... ON CONFLICT DO NOTHING RETURNING`; the existing `achievements` table + unique index `(user_id, type, COALESCE(data->>'task_id',''))` is reused — NO new migration):
- `first_task_completed` — first ever completion (global, no task_id slot).
- `daily_streak_{7,14,30,90}` — `event.streaks.daily >= N` (global per type).
- `repeatable_streak_{7,30,100}` — `repeat_series_id != null && event.streaks.series >= N`; slot = series id.
- `productivity_burst_10` — `>=10` completions in the user-local day; slot = local date (once PER day).
- `accountable_procrastination` — `task.deferral_count >= 3`; slot = task id.
- `high_weight_completed` — `event.weightAtCompletion >= config.achievements.highWeightThreshold` (default 200; add to config); slot = task id (once per task).

CONFIRMED decisions: DD-1 burst once-per-user-local-day; DD-2 high_weight once-per-qualifying-task using the ALREADY-COMPUTED `event.weightAtCompletion` (never recompute); DD-3 streak milestones fire on `>= N` (idempotency prevents re-fire).

KEY DESIGN CRUX (the unique index keys on `data->>'task_id'`): every PER-SLOT achievement stores its slot value under the `data.task_id` key (even when it's semantically a series id or a local date), PLUS a readable alias (`series_id` / `local_date`). Global-once types store no task_id. This reuses the existing index with no migration. (One open nicety the user was asked about: whether to keep this `data.task_id` slot reuse vs a small migration adding a dedicated `slot` column — proceed with the reuse unless the user says otherwise.)

Design specifics to implement: pure `candidateUnlocks(event, threshold)` for event-derivable milestones (daily/series/accountable/high_weight); `first_task_completed` + `productivity_burst_10` are DB-dependent. Repository `countCompletionsOnLocalDay(userId, tz, localDay)` uses `WHERE (completed_at AT TIME ZONE $tz)::date = $localDay::date` (tz-correct day bucketing; the just-completed task is already persisted and counted). `unlock(userId, type, slot|null)` returns true iff a new row was created → append to event.unlocked only then. `GET /api/achievements` behind authMiddleware, `{success,data}`, user-scoped. Register listener AFTER streaks in registerAllListeners. Integration tests use the listener-reset determinism pattern (register streak THEN achievements).

## REMAINING after achievements

- **task-recurrence** (own spec, not written): on completing a repeatable task, generate next occurrence (copy subject/priority/projects/is_repeatable/repeat_pattern/repeat_series_id; due_date from pure recurrence math: daily interval / weekly days_of_week or interval weeks; stop past end_date). Completion listener.
- **analytics** (`.kiro/specs/analytics/` — not written): `GET /api/analytics/projects` — per project: tasks_completed, weight_completed (SUM of weight_at_completion), last_completion_date. Read-only aggregation.
- **Frontend** (`task-master-front/` greenfield): React+TS+Vite PWA. Login (Google first), TaskList/"What's Next?", QuickAdd, defer/complete modals, Projects (dnd-kit reorder), Profile (achievements/streaks/economy + celebration toasts), Settings (theme, focus mode, toggles), dark mode. Access token in memory + axios refresh interceptor; same-origin via Vite proxy in dev.
- **Dockerfiles + k8s manifests + ArgoCD** (`k8s/` dir per tech spec §2/§8): backend + frontend images to `magmakomer`, Postgres StatefulSet+PVC, migrate Job, ingress (Traefik), Sealed Secrets, ArgoCD app-of-apps, overlays/local (NodePort/local host) then overlays/prod (domain + cert-manager Let's Encrypt).

## API surface so far (all under /api, JSON envelopes `{success, data}` / `{success:false, error:{code,message,details}}`)

- Auth: POST /api/auth/{register,login,google,refresh,logout}, GET /api/auth/me, PATCH /api/auth/me (update timezone)
- Tasks: GET /api/tasks (?project_id=&include_completed=), POST /api/tasks, PUT /api/tasks/:id, PUT /api/tasks/:id/complete, PUT /api/tasks/:id/defer, DELETE /api/tasks/:id
- Projects: GET/POST /api/projects, PUT /api/projects/reorder, PUT /api/projects/:id, DELETE /api/projects/:id
- Economy: GET /api/economy
- Streaks: GET /api/streaks
- Health: GET /health

## First actions for the fresh session

1. Read this file + `docs/prd.md` + `docs/technical-specification.md` + the relevant `.kiro/specs/`.
2. Ensure Docker Postgres is up (`docker compose up -d`); confirm `npm test` in `task-master-server` is green (118 tests).
3. Resume at **achievements**: write the spec, get the user's confirmation, then build → verify. Continue the spec→confirm→build→verify loop for task-recurrence, analytics, then frontend, then Docker/k8s.
