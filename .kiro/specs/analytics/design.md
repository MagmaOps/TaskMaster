# Design Document

## Overview

Project analytics is a **read-only aggregation** behind one authenticated endpoint, `GET /api/analytics/projects`. It returns one Project_Analytics_Row per Owned_Project: `projectId`, `name`, `priorityOrder`, `color`, `tasksCompleted`, `weightCompleted`, and `lastCompletionDate`. There are no writes, no completion listener, and no new migration.

The feature reuses infrastructure that already exists and is tested on disk:

- `tasks` (`completed_at`, `archived_at`, `weight_at_completion`), `projects`, `task_projects` — migrations `1000000000001`, `1000000000003`.
- The authenticated read pattern + `{ success, data }` envelope — mirrors `economyController`/`streaksController` and `economyRoutes`.
- `resolveTimezone` / `localCalendarDate` — `src/services/time/userTime.ts`.
- The `pg` query helper — `src/database/pool.ts`.

The frontend and non-project analytics are out of scope.

### Confirmed Design Decisions

The working assumptions flagged in the requirements are now final:

- **DD-1 — include projects with no completions.** A `LEFT JOIN` from `projects` keeps every Owned_Project; projects with no Completed_Tasks report `tasksCompleted = 0`, `weightCompleted = 0`, `lastCompletionDate = null`. (Requirement 3.1)
- **DD-2 — multi-project completions count per project.** Aggregation is over the `task_projects` join, so a task in N projects contributes to each; cross-project totals may exceed the distinct completed-task count. (Requirement 1.4)
- **DD-3 — unassigned effort surfaces as the Unassigned project.** After the projects-management Unassigned-project revision, every task has exactly one project membership (a Real_Project or its owner Unassigned project), so the per-project aggregate covers all completed tasks with no special-casing; the previously project-less rollup appears as the Unassigned project row. (Requirement 3.2)
- **DD-4 — `lastCompletionDate` is the user-local calendar date.** SQL selects `MAX(completed_at)` (the true instant) per project; the service converts that instant to the user timezone calendar day via `localCalendarDate(tz, instant)`. (Requirements 2.1, 2.3, 2.4)
- **DD-5 — null `weight_at_completion` counts as 0 weight.** `COALESCE(SUM(weight_at_completion), 0)` and `SUM(COALESCE(weight_at_completion, 0))` are equivalent here; the task is still counted in `tasksCompleted`. (Requirement 1.3)

## Architecture

Standard layered read path: **route -> controller -> service -> repository -> `pg`**.

```
GET /api/analytics/projects
  analyticsRoutes  (authMiddleware, scopes to req.userId)
    -> analyticsController.getProjects
      -> analyticsService.getProjectAnalytics(userId)
        -> userRepo.findById(userId)                       resolve timezone
        -> analyticsRepository.projectCompletionStats(userId)   one aggregate query
        -> map MAX(completed_at) instant -> User_Local_Date via localCalendarDate(tz, instant)
```

The timezone conversion for `lastCompletionDate` happens in the **service**, not SQL: the repository returns the raw `MAX(completed_at)` instant (a `Date` or null) per project, and the service converts it with `localCalendarDate(tz, instant)`. This keeps the SQL portable and reuses the exact helper streaks/achievements use, rather than pushing `AT TIME ZONE` into the aggregate. Selecting the max by instant also satisfies Requirement 2.4 (pick the latest by true instant, then truncate to the local day).

## Components and Interfaces

### analyticsRepository (`src/repositories/analyticsRepository.ts`)

One aggregate query, parameterized and user-scoped (Requirement 6.2, 6.3). A `LEFT JOIN` from `projects` to the completed tasks (via `task_projects`) keeps every Owned_Project (DD-1); the join predicate filters to Completed_Tasks so non-completed/archived tasks never contribute (Requirement 1.5).

```ts
export interface ProjectCompletionStatsRow {
  id: string;
  name: string;
  priority_order: number;
  color: string | null;
  tasks_completed: number;      // ::int
  weight_completed: number;     // ::int (COALESCE sum, null->0)
  last_completed_at: Date | null;  // MAX(completed_at) instant, or null
}

export async function projectCompletionStats(userId: string): Promise<ProjectCompletionStatsRow[]>;
```

Query:

```sql
SELECT
  p.id, p.name, p.priority_order, p.color,
  COUNT(t.id)::int AS tasks_completed,
  COALESCE(SUM(t.weight_at_completion), 0)::int AS weight_completed,
  MAX(t.completed_at) AS last_completed_at
FROM projects p
LEFT JOIN task_projects tp ON tp.project_id = p.id
LEFT JOIN tasks t
  ON t.id = tp.task_id
  AND t.user_id = $1
  AND t.completed_at IS NOT NULL
  AND t.archived_at IS NULL
WHERE p.user_id = $1
GROUP BY p.id
ORDER BY p.priority_order ASC
```

Notes:

- The Completed_Task predicate lives in the `LEFT JOIN ... ON` clause (not a `WHERE`), so a project with no completions still yields a row with `COUNT = 0` and `MAX = NULL` (DD-1). Putting `t.completed_at IS NOT NULL` in a `WHERE` would drop empty projects.
- `COUNT(t.id)` counts only matched (completed) task rows -> 0 for empty projects (Requirement 1.2).
- `t.user_id = $1` in the join is defense-in-depth alongside `p.user_id = $1`; a project only ever links to its owner's tasks, but scoping both sides keeps the aggregate strictly user-scoped (Requirement 5.2).
- Multi-project tasks: because we aggregate over `task_projects`, a task in N projects is counted in each of the N groups (DD-2).
- `pg` returns `MAX(completed_at)` as a JS `Date` (or null); the service converts it to the User_Local_Date.

### analyticsService (`src/services/analytics/analyticsService.ts`)

```ts
export interface ProjectAnalytics {
  projectId: string;
  name: string;
  priorityOrder: number;
  color: string | null;
  tasksCompleted: number;
  weightCompleted: number;
  lastCompletionDate: string | null;  // 'YYYY-MM-DD' in the user zone, or null
}

export async function getProjectAnalytics(userId: string): Promise<ProjectAnalytics[]>;
```

Steps:

1. `const user = await userRepo.findById(userId); const tz = resolveTimezone(user?.settings.timezone);` (UTC fallback when missing/invalid).
2. `const rows = await analyticsRepository.projectCompletionStats(userId);`
3. Map each row to a `ProjectAnalytics`: `lastCompletionDate = row.last_completed_at ? localCalendarDate(tz, row.last_completed_at) : null` (Requirement 2.1, 2.3); pass `tasksCompleted`/`weightCompleted` through (already ints); rename `id -> projectId`, `priority_order -> priorityOrder`.

Ordering is preserved from the SQL (`priority_order ASC`, Requirement 4.1). The service performs no writes (Requirement 6.1).

Note: `localCalendarDate(tz, instant)` accepts an explicit instant (its second parameter), so the user-local day of each project's latest completion is derived from that project's own `MAX(completed_at)` — not from "now".

### analyticsController (`src/controllers/analyticsController.ts`)

Mirrors `economyController`/`streaksController`:

```ts
export async function getProjects(req, res, next): Promise<void> {
  try {
    const data = await analyticsService.getProjectAnalytics(req.userId as string);
    res.status(200).json({ success: true, data });
  } catch (err) { next(err); }
}
```

### analyticsRoutes (`src/routes/analyticsRoutes.ts`)

Mirrors `economyRoutes`; mounted at `/api/analytics` in `app.ts`.

```ts
const router = Router();
router.use(authMiddleware);         // 401 when unauthenticated (Requirement 5.1)
router.get('/projects', analyticsController.getProjects);
export default router;
```

`app.ts` adds `app.use('/api/analytics', analyticsRoutes);`.

## Data Models

### Existing tables (no migration)

- `projects` (`id`, `user_id`, `name`, `priority_order`, `color`, ...) — the row set and ordering.
- `task_projects` (`task_id`, `project_id`) — the many-to-many the aggregate groups over.
- `tasks` (`id`, `user_id`, `completed_at`, `archived_at`, `weight_at_completion`) — the completion facts.

### Types

New: `ProjectCompletionStatsRow` (repository, DB shape) and `ProjectAnalytics` (service/API DTO). `ProjectRow` and the user/timezone helpers are reused unchanged. No change to `CompletionEvent` or any listener (analytics is not a listener).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement about what the system should do. Properties bridge human-readable specs and machine-verifiable guarantees.*

Analytics is a DB aggregation with little pure logic, so the properties are validated against `projectCompletionStats` / `getProjectAnalytics` using the integration Postgres (the same DB the rest of the suite uses), seeding known tasks/projects and asserting the aggregates.

### Property 1: Count and weight match the seeded completions

*For any* set of completed tasks seeded across a project, `tasksCompleted` equals the number of that project's completed, non-archived tasks and `weightCompleted` equals the sum of their `weight_at_completion` (null treated as 0).

**Validates: Requirements 1.2, 1.3, 1.5**

### Property 2: Only completed, non-archived, owned tasks contribute

*For any* mix of active, archived, and other-user tasks in a project, none of them affect `tasksCompleted` or `weightCompleted` — only the requesting user's completed, non-archived tasks do.

**Validates: Requirements 1.5, 5.2**

### Property 3: Multi-project completions counted per project

*For any* completed task associated with several projects, its count and weight appear in each of those projects' rows (DD-2).

**Validates: Requirements 1.4**

### Property 4: Every owned project appears exactly once, empty projects zeroed

*For any* set of owned projects, the response contains exactly one row per project (ordered by `priority_order`), and a project with no completed tasks has `tasksCompleted = 0`, `weightCompleted = 0`, `lastCompletionDate = null`.

**Validates: Requirements 1.1, 3.1, 4.1**

### Property 5: Last completion date is the local day of the latest completion

*For any* project with completions, `lastCompletionDate` equals `localCalendarDate(tz, MAX(completed_at))` — the user-zone calendar day of the latest completion instant — and is null exactly when the project has no completions.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

## Error Handling

- **Unauthenticated:** `authMiddleware` responds 401 before the controller runs (Requirement 5.1).
- **Missing user / invalid timezone:** `userRepo.findById` may return null or an unset/invalid timezone; `resolveTimezone` coalesces to UTC and date conversion proceeds (no throw). A user with a valid token but somehow no user row still yields an empty project set -> empty list.
- **No projects:** the aggregate returns zero rows -> the service returns `[]` -> `200 { success: true, data: [] }` (Requirement 5.4).
- **Null `MAX(completed_at)`:** mapped to `lastCompletionDate = null` (Requirement 2.2).
- **Read endpoint errors** are forwarded to the centralized `errorHandler` via `next(err)`, matching `economyController`.
- **SQL safety:** a single parameterized aggregate scoped by `user_id`; no string interpolation (Requirement 6.3).

## Testing Strategy

Property tests validate the aggregation invariants against the integration Postgres; Jest + Supertest integration tests cover the HTTP contract.

### Property-based tests (fast-check, devDependency)

Each property test runs a **minimum of 100 iterations** and is tagged `// Feature: analytics, Property {number}: {property_text}`. DB-backed against the integration Postgres, seeding a fresh user + projects + tasks per run (unique per-run values so rows do not interfere; truncation runs between `it` blocks).

- **Property 1 (Count & weight)** — seed a random number of completed tasks with random weights in a project; assert `tasksCompleted`/`weightCompleted` match the seeded totals (null weights as 0).
- **Property 2 (Only completed/non-archived/owned)** — seed a random mix of active, archived, completed, and other-user tasks; assert only the user completed non-archived ones count.
- **Property 3 (Multi-project)** — seed a completed task linked to K random projects; assert it counts in each.
- **Property 4 (Every project once, empty zeroed)** — seed N projects, some empty; assert exactly N rows, priority_order-ordered, empties zeroed.
- **Property 5 (Last completion date)** — seed completions at random instants; assert `lastCompletionDate === localCalendarDate(tz, max instant)`, null when none.

Each correctness property is implemented by a **single** property-based test using `fast-check`.

### Integration tests (Jest + Supertest)

- **Shape + basic aggregation (Req 1, 3.3):** create 2 projects, complete tasks assigned to them; assert `200 { success, data }` with per-project `tasksCompleted`/`weightCompleted` and the project fields (`projectId`/`name`/`priorityOrder`/`color`).
- **Empty project included (Req 3.1):** a project with no completions appears with zeros and null date.
- **Unassigned rollup (Req 3.2):** a completed task with no Real_Project is owned by the Unassigned project and appears in that project row (not omitted, no synthetic bucket).
- **Multi-project (Req 1.4):** a completed task in two projects contributes to both.
- **Excludes active/archived (Req 1.5):** active and archived tasks in a project do not count.
- **Last completion date + timezone (Req 2, DD-4):** non-UTC user timezone + completions crossing local midnight; assert `lastCompletionDate` is the user-local day of the latest instant.
- **Ordering (Req 4.1):** rows ordered by `priority_order` ascending.
- **Auth + scoping (Req 5):** unauthenticated -> 401; a second user projects/tasks excluded; a user with no projects -> `200` empty list.

### Requirement-to-section map

| Requirement | Design coverage |
| --- | --- |
| 1 Counts & weight | Repository query; Property 1, 3; integration |
| 2 Last completion date | Service tz mapping; Property 5; integration |
| 3 Include empty / Unassigned rollup | LEFT JOIN; Property 4; integration |
| 4 Ordering | ORDER BY priority_order; Property 4; integration |
| 5 Auth & scoping | Route/controller; Property 2; integration |
| 6 Read-only & efficient | Single aggregate query; Error Handling |
