# TaskMaster — Build State & Handoff

**Purpose:** Ground-truth handoff for continuing the rebuild in a fresh session. Read this + the specs in `.kiro/specs/` before doing anything. When in doubt, trust the code and tests on disk over any summary.

**Last verified:** 81 tests passing across 12 suites; TypeScript typecheck clean.

---

## What we're building

A rebuilt **TaskMaster** — a weight-based task-management SaaS (removes decision fatigue by auto-prioritizing tasks; "What's Next?"). Self-hosted on the owner's **k3s** cluster via **ArgoCD** (GitOps), images pushed to Docker Hub namespace **`magmakomer`** (`magmakomer/taskmaster-backend`, `magmakomer/taskmaster-frontend`). Multi-user SaaS with free/premium tiers + virtual economy. Local-first testing now; public domain + TLS added later.

Full product vision: `docs/prd.md`. Full technical spec: `docs/technical-specification.md`.

## Stack decisions (locked)

- **Backend:** Node 18+, Express, **TypeScript** (strict), `pg` (raw parameterized SQL, no ORM), node-pg-migrate. Layered: routes → controller → service → repository. Located in `task-master-server/`.
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

## Local infrastructure

`docker-compose.yml` at repo root runs two Postgres 16 containers (Docker Desktop):
- **postgres** — dev, port **5432**, named volume `taskmaster_pgdata`. DB `taskmaster_dev`, user `postgres`, pass `dev_password`.
- **postgres-test** — test, port **5433**, **tmpfs** (ephemeral). DB `taskmaster_test`, pass `test_password`.

Start: `docker compose up -d`. Backend `.env` points at 5432; `.env.test` at 5433.
Run backend locally: `cd task-master-server && npm run dev` (tsx watch, port 3001).

## Database schema (4 migrations applied to dev)

- `1000000000000_init_users_and_auth`: **users** (id, email unique, password_hash NULLABLE, display_name, avatar_url, tier check(free|premium) default free, currency_balance bigint default 0, settings jsonb, timestamps), **oauth_accounts** (unique (provider,provider_user_id)), **refresh_tokens** (token_hash unique, expires_at, revoked_at, user_agent).
- `1000000000001_init_tasks_projects_gamification`: **tasks** (user_id, subject, priority check(high|medium|low), due_date, due_time, is_repeatable, repeat_pattern jsonb, timestamps, completed_at, archived_at; partial index on active), **projects** (name, priority_order check 1-20, color; unique (user_id,name), unique (user_id,priority_order)), **task_projects** (composite PK), **deferrals** (option_chosen check), **achievements** (unique (user_id,type,COALESCE(data->>'task_id',''))), **streaks** (user_id, task_id nullable FK→tasks, current/longest_streak, last_completed_date; unique (user_id, COALESCE(task_id, zero-uuid))).
- `1000000000002_projects_priority_deferrable`: replaced plain unique INDEX `uq_projects_user_priority` with a **DEFERRABLE INITIALLY DEFERRED** unique CONSTRAINT so multi-row reorders don't collide mid-transaction (the CHECK 1-20 forbids negative temp ranks, so deferred is the fix).
- `1000000000003_completion_support`: `tasks.weight_at_completion integer` (nullable), `tasks.repeat_series_id uuid` (nullable) + partial index. `repeat_series_id` is a **standalone fresh UUID per repeatable series** (NOT a task id), set in `create` via `CASE WHEN $repeatable THEN gen_random_uuid() ELSE NULL END`.

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

## NEXT UP: streaks (`.kiro/specs/streaks/`) — SPEC WRITTEN, AWAITING USER CONFIRMATION (not built yet)

Daily streak (consecutive days ≥1 completion) + per-repeatable-series streak (keyed by `repeat_series_id`). Completion listener. `GET /api/streaks`. Pure `advanceStreak(prev, today)` (first / same-day no-op / yesterday+1 / gap reset). Planned migration `1000000000004_streaks_series_key`.

**TWO OPEN DECISIONS the user must confirm before building streaks:**
1. **Drop `streaks.task_id`?** It's an FK to tasks, but per-series streaks must key on the standalone `repeat_series_id` (not a task id). Plan: add `streaks.series_id uuid` (no FK), re-key the unique index on `(user_id, COALESCE(series_id, zero-uuid))`, and DROP the unused `task_id` column (greenfield, no data). Awaiting OK.
2. **`CompletionEvent.streaks` side-channel + listener ordering?** So achievements can read the just-updated streak value without re-querying: add optional `streaks?: { daily: number; series?: number }` to `CompletionEvent`; the streak listener sets it; **streak listener must be registered BEFORE the achievements listener** in `registerAllListeners`. Awaiting OK.

## REMAINING after streaks

- **achievements** (`.kiro/specs/achievements/` — not written): first_task_completed, daily_streak_{7,14,30,90}, repeatable_streak_{7,30,100}, productivity_burst_10 (per day), accountable_procrastination (deferral_count ≥3), high_weight_completed (weight ≥ threshold, default 200). Unlock via INSERT ON CONFLICT DO NOTHING RETURNING (idempotent). Appends to `event.unlocked` so complete response celebrates. Depends on streaks values. `GET /api/achievements`.
- **task-recurrence** (own spec, not written): on completing a repeatable task, generate next occurrence (copy subject/priority/projects/is_repeatable/repeat_pattern/repeat_series_id; due_date from pure recurrence math: daily interval / weekly days_of_week or interval weeks; stop past end_date). Completion listener.
- **analytics** (`.kiro/specs/analytics/` — not written): `GET /api/analytics/projects` — per project: tasks_completed, weight_completed (SUM of weight_at_completion), last_completion_date. Read-only aggregation.
- **Frontend** (`task-master-front/` greenfield): React+TS+Vite PWA. Login (Google first), TaskList/"What's Next?", QuickAdd, defer/complete modals, Projects (dnd-kit reorder), Profile (achievements/streaks/economy + celebration toasts), Settings (theme, focus mode, toggles), dark mode. Access token in memory + axios refresh interceptor; same-origin via Vite proxy in dev.
- **Dockerfiles + k8s manifests + ArgoCD** (`k8s/` dir per tech spec §2/§8): backend + frontend images to `magmakomer`, Postgres StatefulSet+PVC, migrate Job, ingress (Traefik), Sealed Secrets, ArgoCD app-of-apps, overlays/local (NodePort/local host) then overlays/prod (domain + cert-manager Let's Encrypt).

## API surface so far (all under /api, JSON envelopes `{success, data}` / `{success:false, error:{code,message,details}}`)

- Auth: POST /api/auth/{register,login,google,refresh,logout}, GET /api/auth/me
- Tasks: GET /api/tasks (?project_id=&include_completed=), POST /api/tasks, PUT /api/tasks/:id, PUT /api/tasks/:id/complete, PUT /api/tasks/:id/defer, DELETE /api/tasks/:id
- Projects: GET/POST /api/projects, PUT /api/projects/reorder, PUT /api/projects/:id, DELETE /api/projects/:id
- Economy: GET /api/economy
- Health: GET /health

## First actions for the fresh session

1. Read this file + `docs/prd.md` + `docs/technical-specification.md` + the relevant `.kiro/specs/`.
2. Ensure Docker Postgres is up (`docker compose up -d`); confirm `npm test` in `task-master-server` is green (81 tests).
3. Resume at **streaks**: get the user's answers to the two open decisions above, then build → verify. Continue the spec→confirm→build→verify loop for achievements, task-recurrence, analytics, then frontend, then Docker/k8s.
