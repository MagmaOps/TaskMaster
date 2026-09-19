# TaskMaster - Technical Specification

**Version:** 2.0
**Last Updated:** September 18, 2026
**Status:** MVP Implementation Guide (self-hosted rebuild)

---

## 1. Tech Stack

### Backend
- **Runtime:** Node.js v18+ (LTS)
- **Framework:** Express.js v4.18+
- **Language:** **TypeScript** (ES2022 target, `strict` mode)
- **Authentication:** JWT (access + refresh tokens) via `jsonwebtoken`; Google OAuth 2.0 via `google-auth-library`; password hashing via `bcrypt`
- **Database Driver:** `pg` (node-postgres) with a pooled connection layer (reused from the existing codebase)
- **Validation:** `express-validator`
- **Security:** `helmet`, `cors`, `express-rate-limit`
- **Migrations:** `node-pg-migrate` (existing migrations reused; new ones added)
- **Testing:** Jest + Supertest (ts-jest)
- **Process model:** single Node process per container replica (k8s handles restarts/scaling; no PM2)

### Frontend
- **Framework:** React 18+ with **TypeScript**
- **Build Tool:** **Vite** (dev server + production static bundle)
- **Routing:** React Router v6
- **State Management:** React Context API + hooks
- **HTTP Client:** Axios (with request/response interceptors for auth + refresh)
- **Drag-and-Drop:** `@dnd-kit` (actively maintained; replaces the deprecated react-beautiful-dnd)
- **Date/Time:** `date-fns`
- **PWA:** `vite-plugin-pwa` (Workbox under the hood)
- **Theming:** CSS variables with light + dark themes
- **Testing:** Vitest + React Testing Library

### Database
- **RDBMS:** PostgreSQL 14+
- **Migration Tool:** node-pg-migrate
- **Indexing Strategy:** B-tree indexes on foreign keys, `user_id`, `created_at`; partial indexes for active tasks (already implemented)

### Hosting & Infrastructure (self-hosted)
- **Orchestration:** k3s (multi-node, ArgoCD-managed via GitOps)
- **Images:** Docker Hub namespace `magmakomer`
  - `magmakomer/taskmaster-backend`
  - `magmakomer/taskmaster-frontend`
- **Frontend serving:** static Vite build served by nginx in a container
- **Database:** in-cluster PostgreSQL with a PersistentVolumeClaim
- **Ingress:** k3s ingress controller (Traefik by default)
- **TLS (post-validation):** cert-manager + Let's Encrypt
- **Secrets:** Sealed Secrets (encrypted manifests committed to Git; controller decrypts into k8s Secrets)
- **Local-first:** everything runs and is tested on the local cluster before a public domain/TLS is added

### Development Tools
- **Version Control:** Git (single monorepo) + GitHub
- **Formatting:** Prettier
- **Linting:** ESLint (TypeScript rules)
- **API Testing:** curl / REST client
- **Local Database:** Docker PostgreSQL (docker-compose) for pure-local dev without the cluster

---

## 2. Repository Layout (Monorepo)

```
TaskMaster/
├── task-master-front/        # React + TS + Vite PWA
├── task-master-server/       # Express + TS API (existing DB layer reused)
├── k8s/                      # Kubernetes manifests (ArgoCD-synced)
│   ├── base/                 # namespace, postgres, backend, frontend, ingress
│   ├── overlays/local/       # local testing (NodePort / local host, no public TLS)
│   ├── overlays/prod/        # public domain + cert-manager TLS (added later)
│   ├── sealed-secrets/       # *-sealed.yaml (safe to commit)
│   └── argocd/               # app-of-apps + Application manifests
├── docs/                     # prd.md, technical-specification.md, database/
└── .kiro/                    # steering + specs
```

Two images are built and pushed to Docker Hub; ArgoCD watches `k8s/` and syncs the cluster to Git.

---

## 3. Database Schema

The existing schema (12 migrations under `task-master-server/src/database/migrations/`) is reused as the foundation: `users`, `tasks`, `projects`, `task_projects`, `deferrals`, `achievements`, `streaks`, plus indexing, constraints, and JSONB-validation migrations.

### 3.1 Entity Relationship Diagram (ERD)

```
users (1) ----< (M) tasks
users (1) ----< (M) projects
users (1) ----< (M) achievements
users (1) ----< (M) streaks
users (1) ----< (M) oauth_accounts     [NEW]
users (1) ----< (M) refresh_tokens     [NEW]

tasks (M) >----< (M) projects [via task_projects junction table]
tasks (1) ----< (M) deferrals
```

### 3.2 Schema Changes Required for v2 Auth

The current `users` table has `password_hash VARCHAR(255) NOT NULL`. That blocks Google-only accounts (which have no password). Two new migrations are required:

**Migration A — relax password + add auth/billing columns on `users`:**
```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;   -- Google-only users have no password
ALTER TABLE users ADD COLUMN display_name VARCHAR(255);
ALTER TABLE users ADD COLUMN avatar_url   VARCHAR(1024);
ALTER TABLE users ADD COLUMN tier         VARCHAR(20) NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free','premium'));
ALTER TABLE users ADD COLUMN currency_balance BIGINT NOT NULL DEFAULT 0;  -- virtual economy
-- Ensure a user has at least one credential (password or a linked oauth account)
-- enforced in application logic + a partial constraint where practical.
```

**Migration B — `oauth_accounts` (links external identities to a user):**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default gen_random_uuid() | Row id |
| `user_id` | UUID | FK → users(id) ON DELETE CASCADE, NOT NULL | Owner |
| `provider` | VARCHAR(20) | NOT NULL, CHECK IN ('google') | OAuth provider |
| `provider_user_id` | VARCHAR(255) | NOT NULL | Google `sub` claim |
| `email` | VARCHAR(255) | NULL | Email reported by provider |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
```sql
CREATE UNIQUE INDEX idx_oauth_provider_user ON oauth_accounts(provider, provider_user_id);
CREATE INDEX idx_oauth_user_id ON oauth_accounts(user_id);
```

**Migration C — `refresh_tokens` (revocable sessions):**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default gen_random_uuid() | Row id |
| `user_id` | UUID | FK → users(id) ON DELETE CASCADE, NOT NULL | Owner |
| `token_hash` | VARCHAR(255) | NOT NULL | SHA-256 of the refresh token (never store raw) |
| `expires_at` | TIMESTAMPTZ | NOT NULL | Expiry |
| `revoked_at` | TIMESTAMPTZ | NULL | Set on logout/rotation |
| `user_agent` | VARCHAR(512) | NULL | Device info for session list |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
```sql
CREATE INDEX idx_refresh_user_id ON refresh_tokens(user_id);
CREATE UNIQUE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
```

The `settings` JSONB on `users` continues to hold UI preferences and gains a `theme` key:
```json
{
  "project_priority_enabled": true,
  "achievement_toasts_enabled": true,
  "focus_mode_enabled": false,
  "weight_visibility_enabled": false,
  "theme": "system"   // "system" | "light" | "dark"
}
```

### 3.3 Existing Tables (unchanged, summarized)

- **tasks**: `id, user_id (FK cascade), subject, priority CHECK(high|medium|low), due_date, due_time, created_at, completed_at, archived_at, is_repeatable, repeat_pattern (JSONB), updated_at`. Partial index on active tasks.
- **projects**: `id, user_id (FK cascade), name, priority_order (1–20 CHECK), color, timestamps`. Unique `(user_id,name)` and `(user_id,priority_order)`.
- **task_projects**: composite PK `(task_id, project_id)`, both FKs cascade.
- **deferrals**: `id, task_id (FK cascade), deferred_at, option_chosen CHECK(later_today|tomorrow|sometime_later)`.
- **achievements**: `id, user_id (FK cascade), type, unlocked_at, data (JSONB)`, unique per `(user_id, type, data->>'task_id')`.
- **streaks**: `id, user_id (FK cascade), task_id (nullable FK cascade), current_streak, longest_streak, last_completed_date, updated_at`.

Full column-level detail is in `docs/database/schema-documentation.md`.

---

## 4. Weight Algorithm Implementation

### 4.1 Constants
```typescript
const PRIORITY_MULTIPLIERS = { high: 3, medium: 2, low: 1 } as const;
const DEFERRAL_WEIGHT_BONUS = 5;             // +5 weight per deferral
const OVERDUE_PENALTY_MULTIPLIER = 10;       // per day overdue
const DUE_SOON_BONUS_MAX = 35;               // max bonus within 7 days
const REPEATABLE_DUE_DATE_MULTIPLIER = 2;    // 2x on the scheduled day
```

### 4.2 Main Calculation (behavior)
```
weight = (ageInDays + 1) * PRIORITY_MULTIPLIERS[priority]

if due_date:
  daysUntilDue < 0  -> weight += |daysUntilDue| * OVERDUE_PENALTY_MULTIPLIER
  0..7 days         -> weight += (7 - daysUntilDue) * (DUE_SOON_BONUS_MAX / 7)
  > 7 days          -> no change

if due_time and due today:
  hoursUntilDue in [0,24] -> weight += (24 - hoursUntilDue) * 2

if project priority enabled and task assigned:
  pick highest-priority project the task belongs to
  weight *= (1 + projectMultiplier(priority_order, totalProjects))

weight += deferralCount * DEFERRAL_WEIGHT_BONUS

if is_repeatable and due today:
  weight *= REPEATABLE_DUE_DATE_MULTIPLIER

return round(weight)
```

### 4.3 Project Multiplier
```
totalProjects == 1  -> 1.0
otherwise           -> clamp(1.0 - (priority_order - 1) / (totalProjects - 1), 0, 1)
// 4 projects -> [1.0, 0.67, 0.33, 0.0]
```

### 4.4 Deferral Logic
- **later_today:** ensure `due_date = today`; insert deferral row (increments count).
- **tomorrow:** `due_date = tomorrow`; insert deferral row.
- **sometime_later:** downgrade priority one level (high→medium→low→low), clear `due_date`/`due_time`; insert deferral row.

Weight is recalculated server-side on every task fetch, and returned per task. Free users receive weight ordering only; premium users may also receive a `weight_breakdown` object when weight visibility is enabled.

---

## 5. API Specification

### 5.1 Base URL
```
Local dev:  http://localhost:3001
In-cluster: http://taskmaster-backend.taskmaster.svc.cluster.local:3001
Public:     https://<your-domain>   (added after local validation)
```

### 5.2 Auth Model
- **Access token:** JWT, ~15 min TTL, sent as `Authorization: Bearer <token>`.
- **Refresh token:** opaque random string, ~30 day TTL, stored hashed server-side (`refresh_tokens`), delivered to the client as an httpOnly, Secure, SameSite cookie (web) or secure storage (future mobile). Rotated on each use; old token revoked.
- Google OAuth is verified server-side using `google-auth-library` (ID token verification). On success the backend finds/creates the `oauth_accounts` + `users` rows and issues the app's own access/refresh tokens.

### 5.3 Auth Routes

#### POST `/api/auth/register` — email + password
Request: `{ "email": "...", "password": "...", "display_name": "..."? }`
Rules: valid email (stored lowercase), password ≥ 8 chars incl. letter + number.
Success 201: `{ "user": {...}, "accessToken": "..." }` (refresh token set as httpOnly cookie).
Errors: 400 (validation / email exists), 429 (rate limited), 500.

#### POST `/api/auth/login` — email + password
Request: `{ "email": "...", "password": "..." }`
Success 200: `{ "user": {...}, "accessToken": "..." }` (+ refresh cookie).
Errors: 401 (generic "Invalid email or password"), 429, 500.

#### POST `/api/auth/google` — Google OAuth (primary)
Request: `{ "idToken": "<google id token from client>" }`
Behavior: verify token → match `oauth_accounts` by `(google, sub)`; if none, link to an existing user by verified email or create a new user; issue app tokens.
Success 200: `{ "user": {...}, "accessToken": "...", "isNewUser": bool }` (+ refresh cookie).
Errors: 401 (invalid token), 500.
Config: requires `GOOGLE_CLIENT_ID` (and client secret for server flows). Until configured, the endpoint returns 503 and the frontend hides/disables the Google button.

#### POST `/api/auth/refresh`
Uses the refresh cookie to issue a new access token and rotate the refresh token.
Success 200: `{ "accessToken": "..." }`. Errors: 401 (missing/expired/revoked).

#### POST `/api/auth/logout`
Revokes the current refresh token and clears the cookie. 204.

#### GET `/api/auth/me`
Returns the authenticated user profile (id, email, display_name, avatar_url, tier, settings, currency_balance).

### 5.4 Tasks Routes (all require access token)
- `GET /api/tasks?project_id=&include_completed=` → weight-sorted array; each task includes `weight`, `deferral_count`, `projects[]`, and (premium + enabled) `weight_breakdown`.
- `POST /api/tasks` → create (`subject`, `priority`, optional `due_date`, `due_time`, `project_ids[]`, `is_repeatable`, `repeat_pattern`).
- `PUT /api/tasks/:id` → update (partial).
- `PUT /api/tasks/:id/complete` → set `completed_at`, run achievement + streak checks, award currency (= weight at completion).
- `PUT /api/tasks/:id/defer` → `{ "option": "later_today|tomorrow|sometime_later" }`, inserts deferral, applies deferral logic.
- `DELETE /api/tasks/:id` → soft delete (`archived_at`). 204.

### 5.5 Projects Routes
- `GET /api/projects` → sorted by `priority_order` ASC, each with `task_count`.
- `POST /api/projects` → `{ name, color? }`; enforce ≤ 20; 409 on duplicate name.
- `PUT /api/projects/:id` → update name/color.
- `PUT /api/projects/reorder` → `{ project_ids: [...] }` (index → priority_order).
- `DELETE /api/projects/:id`.

### 5.6 Gamification & Analytics Routes
- `GET /api/achievements` → unlocked achievements.
- `GET /api/streaks` → daily streak + per-repeatable-task streaks.
- `GET /api/analytics/projects` → per-project completion counts, weight completed, streaks.
- `GET /api/economy` → currency balance + earn history summary.

### 5.7 Standard Response & Errors
Success envelope: `{ "success": true, "data": ... }` (or bare resource for list endpoints, documented per route).
Error envelope: `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`.
Status codes: 400 validation, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict, 429 rate limited, 500 server error, 503 feature not configured.

---

## 6. Frontend Architecture

### 6.1 Pages
```
src/pages/
├── Login.tsx              # Google button FIRST, then email/password form
├── TaskList.tsx           # landing: "What's Next?" + list
├── ProjectManagement.tsx  # Settings → Projects (drag-and-drop)
├── Profile.tsx            # achievements, streaks, analytics, economy
└── Settings.tsx           # theme, focus mode, toggles, (premium) weight visibility
```

### 6.2 Components
```
src/components/
├── layout/        BottomNav, Header, Toast, ThemeProvider
├── tasks/         TaskCard, TaskList, QuickAddModal, ActionModal, DeferralModal, TaskForm
├── projects/      ProjectList, ProjectCard, ProjectSelector, CreateProjectModal
├── gamification/  AchievementGallery, AchievementCard, StreakDisplay, ToastCelebration
└── common/        Button, Input, DatePicker, TimePicker, Spinner
```

### 6.3 State (Context Providers)
- `AuthContext` — user, access token in memory, silent refresh via `/api/auth/refresh`, login/logout, Google sign-in.
- `TaskContext` — tasks, CRUD, defer/complete.
- `ProjectContext` — projects, reorder.
- `SettingsContext` — preferences incl. theme (light/dark/system).

### 6.4 Auth handling
Access token kept in memory (not localStorage) to reduce XSS exposure; refresh token in httpOnly cookie. Axios interceptor retries once on 401 by calling `/api/auth/refresh`. Google sign-in uses Google Identity Services to obtain an ID token, POSTed to `/api/auth/google`.

---

## 7. Environment Variables

### 7.1 Backend (`.env`)
```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/taskmaster_dev

# JWT / sessions
JWT_ACCESS_SECRET=<32+ char secret>
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
BCRYPT_ROUNDS=10                      # 12 in production

# Google OAuth (added later; endpoint returns 503 until set)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# CORS
CORS_ORIGIN=http://localhost:5173     # Vite dev server default
```

### 7.2 Frontend (`.env`)
```bash
VITE_API_URL=http://localhost:3001
VITE_GOOGLE_CLIENT_ID=                # same client id; empty => hide Google button
VITE_ENV=development
```

In-cluster, these come from k8s ConfigMaps/Secrets (Secrets sourced from Sealed Secrets).

---

## 8. Deployment Architecture (k3s + ArgoCD)

### 8.1 Workloads
- **postgres**: StatefulSet (or Deployment + PVC) with a PersistentVolumeClaim; not exposed outside the cluster. Multi-node note: the PVC's StorageClass must support scheduling where the DB pod runs (e.g. `local-path` pins to a node; Longhorn/NFS allows rescheduling). Choose based on the lab's storage.
- **migrate (Job)**: runs `npm run migrate` against Postgres before/with backend rollout (ArgoCD sync hook / init pattern).
- **backend**: Deployment of `magmakomer/taskmaster-backend`, `/health` readiness + liveness probes, env from ConfigMap + Secret.
- **frontend**: Deployment of `magmakomer/taskmaster-frontend` (nginx serving the Vite build), readiness probe on `/`.
- **ingress**: routes `/api` → backend Service, everything else → frontend Service.

### 8.2 Secrets (Sealed Secrets)
Plaintext Secret → `kubeseal` → committed `*-sealed.yaml`. The Sealed Secrets controller decrypts into a real Secret in-cluster. Sealed values (DB password, `JWT_ACCESS_SECRET`, Google client secret) are safe to commit. Raw `.env`/plaintext secrets are gitignored.

### 8.3 Local-first, then public
- **Local (overlays/local):** no public domain, no cert-manager. Expose via NodePort or a local ingress host (e.g. `taskmaster.local` in `/etc/hosts`). Self-signed or plain HTTP acceptable for testing.
- **Public (overlays/prod, added later):** real domain → ingress; cert-manager `ClusterIssuer` (Let's Encrypt) provisions TLS; `CORS_ORIGIN`, `VITE_API_URL`, and Google OAuth redirect URIs updated to the public host. This is the only change needed to go public.

### 8.4 ArgoCD
An app-of-apps `Application` points at `k8s/argocd/`, which declares child `Application`s for postgres, backend, frontend, and ingress. ArgoCD keeps the cluster in sync with the monorepo.

### 8.5 Local dev without the cluster
`docker-compose.yml` (Postgres only needed) supports running the backend/frontend directly on the workstation for fast iteration, independent of k3s.

---

## 9. Testing Strategy
- **Backend:** Jest + Supertest — unit tests for the weight algorithm and auth/token logic; integration tests for routes against a test Postgres (existing `taskmaster_test` pattern).
- **Frontend:** Vitest + React Testing Library — component and context tests.
- **DB:** existing migration/constraint/integrity tests retained.
- CI runs lint + tests before building images.

---

## 10. Migration From v1 Codebase
- **Keep:** the entire `task-master-server/src/database/` layer (connection pool, migrations, utils, tests). It is the one mature, tested part of the old build.
- **Add:** migrations A/B/C (§3.2) for OAuth + refresh tokens + user profile/tier/currency.
- **Rewrite:** the Express app in TypeScript with real routes/controllers/services/middleware (the old `server.js` was a health-check stub).
- **Replace:** the frontend entirely with a React + TS + Vite PWA (the old `App.js` was a placeholder).
- **Retire:** AWS/EC2/RDS/PM2 and Redis references from v1; not used in the self-hosted model.

---

**End of Technical Specification**

*For product context, see: `docs/prd.md`. For schema detail, see: `docs/database/`.*
