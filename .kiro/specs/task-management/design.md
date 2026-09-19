# Task Management Design

## Overview

Implements `requirements.md`: task CRUD, complete, defer, archive, weight-sorted listing, and the weight algorithm. Follows the same layering as auth (routes → controller → service → repository) and reuses the DB pool, error types, and `authMiddleware`. Weight is computed in a pure, dependency-free module so it is trivially unit-testable and produces identical output for identical inputs.

The `tasks`, `projects`, `task_projects`, and `deferrals` tables already exist (migration `1000000000001`). No new migrations are required for this spec.

## Architecture

```
authMiddleware → taskRoutes → validate → taskController → taskService
                                                              ├── taskRepository       (tasks, task_projects)
                                                              ├── deferralRepository    (deferrals + counts)
                                                              ├── projectRepository(min) (fetch user's projects for weighting)
                                                              └── weight/calculateWeight (pure function)
```

Projects get their own full spec/repository later; here we add only the minimal read needed for weighting (list a user's projects with `priority_order`, and the project ids per task). When the projects spec lands, that repository is the shared home; for now a small `projectReadRepository` provides just what weighting needs.

## The weight module (`src/services/tasks/weight.ts`)

Pure functions, no DB access. Inputs are plain data; output is a number (and optionally a breakdown).

```ts
type Priority = 'high' | 'medium' | 'low';
const PRIORITY_MULTIPLIER = { high: 3, medium: 2, low: 1 };
const DEFERRAL_BONUS = 5;
const OVERDUE_PER_DAY = 10;
const DUE_SOON_MAX = 35;          // spread continuously over the 7-day window
const DUE_SOON_DAYS = 7;
const REPEATABLE_TODAY_MULTIPLIER = 2;

interface WeightInput {
  createdAt: Date;
  priority: Priority;
  dueDate: string | null;   // 'YYYY-MM-DD'
  dueTime: string | null;   // 'HH:MM'
  isRepeatable: boolean;
  deferralCount: number;
  // Highest-priority project this task belongs to, if project weighting applies:
  projectPriorityOrder: number | null;
  totalProjects: number;    // count for the user (for multiplier scaling)
  projectWeightingEnabled: boolean;
  now?: Date;               // injectable for deterministic tests
}

calculateWeight(input: WeightInput): number
calculateWeightBreakdown(input: WeightInput): WeightBreakdown  // { base, dueProximity, project, deferral, repeatable, total }
```

Algorithm (matches Requirement 3 and tech spec §4) — **due weighting is continuous on hours** so `due_time` matters throughout the countdown, not only on the due day:
1. `ageInDays = floor((now - createdAt)/86400000)`; `weight = (ageInDays + 1) * PRIORITY_MULTIPLIER[priority]`.
2. Derive the due moment: `dueDate` at `dueTime` (local); if `dueTime` is null, use 23:59:59 local of `dueDate`. Compute `hoursUntilDue` as exact fractional hours from `now`.
3. Due proximity (single continuous rule, replaces the old separate date/time rules):
   - overdue (`hoursUntilDue < 0`): `daysOverdue = ceil(|hoursUntilDue| / 24)`; `weight += daysOverdue * 10`.
   - within window (`0 <= hoursUntilDue <= 168`): `weight += (7 - hoursUntilDue/24) * (35/7)`.
   - beyond 7 days: no change.
   So a task due tomorrow 09:00 outweighs one due tomorrow 23:00 starting today.
4. Project (only if `projectWeightingEnabled` and `projectPriorityOrder != null`): `weight *= (1 + projectMultiplier)`.
5. `weight += deferralCount * 5`.
6. Repeatable due today → `weight *= 2` (uses the same due-moment's calendar day).
7. `return Math.round(weight)`.

`projectMultiplier(order, total)`: `total <= 1 → 1.0`; else `clamp(1 - (order-1)/(total-1), 0, 1)`.

Due-moment construction uses the server's local time consistently for `now` and the due moment; `now` is injectable so tests are deterministic. The breakdown reports a single `dueProximity` contribution (overdue or due-soon) rather than separate date/time lines.

## Components and Interfaces

### taskRepository (`src/repositories/taskRepository.ts`)
- `create(userId, data): TaskRow`
- `findActiveByUser(userId, { projectId?, includeCompleted? }): TaskRowWithMeta[]` — joins deferral counts and project ids in one query (avoids N+1).
- `findByIdForUser(userId, id): TaskRowWithMeta | null`
- `update(userId, id, patch): TaskRow | null`
- `setCompleted(userId, id): TaskRow | null` (only if active)
- `applyDefer(userId, id, patch): TaskRow` (priority/date changes)
- `archive(userId, id): boolean`
- `setProjects(userId, taskId, projectIds)` — replaces associations, validating ownership (transaction).

### deferralRepository (`src/repositories/deferralRepository.ts`)
- `record(taskId, option)` — insert a deferral row.

### projectReadRepository (`src/repositories/projectReadRepository.ts`)
- `listForUser(userId): { id, priority_order }[]`
- `assertOwned(userId, projectIds): void` — throws 400 if any id isn't the user's.
(These read helpers are superseded by the full projectRepository in the projects spec.)

### taskService (`src/services/tasks/taskService.ts`)
Orchestrates repositories + weight. For listing: fetch tasks-with-meta, fetch the user's projects + `project_priority_enabled`/tier/weight-visibility from the user settings, compute weight (and breakdown when premium+enabled) per task, sort desc, map to API DTOs. For complete: set completed, capture weight-at-completion, then call the gamification hook (see below).

### Completion hook (Requirement 5.4)
`taskService.completeTask` accepts an optional injected `onCompleted(ctx)` callback (default no-op). The gamification spec will provide the real implementation and wire it in. This keeps task-management free of gamification logic while defining the seam now. `ctx = { userId, task, weightAtCompletion }`.

### taskController + taskRoutes
Standard controllers delegating to the service; routes mounted at `/api/tasks` behind `authMiddleware`, with express-validator rules per endpoint.

## API Endpoints
- `GET  /api/tasks?project_id=&include_completed=` → 200 `{ success, data: Task[] }` (weight-sorted)
- `POST /api/tasks` → 201 `{ success, data: Task }`
- `PUT  /api/tasks/:id` → 200 `{ success, data: Task }`
- `PUT  /api/tasks/:id/complete` → 200 `{ success, data: { ...Task, weightAtCompletion } }`
- `PUT  /api/tasks/:id/defer` → 200 `{ success, data: Task }`  body `{ option }`
- `DELETE /api/tasks/:id` → 204

`Task` DTO: `{ id, subject, priority, dueDate, dueTime, isRepeatable, repeatPattern, createdAt, completedAt, projects: [{id,name,priorityOrder,color}], deferralCount, weight, weightBreakdown? }`.

## Repeatable tasks (scope boundary)
This spec stores `is_repeatable` + `repeat_pattern` and applies the due-today ×2 weight boost. It does **not** regenerate the next occurrence on completion and does **not** manage streaks — both are owned by the gamification spec, which will use the completion hook.

## Error Handling
Reuses `ApiError` + central error middleware. `VALIDATION_ERROR` (400), `NOT_FOUND` (404, includes wrong-owner to avoid leaking existence), `CONFLICT` (409 on re-complete).

## Testing Strategy
- **Unit (no DB):** `weight.ts` — base/age, overdue, due-soon curve, due-time, project multiplier (1 project, N projects, disabled), deferral accumulation, repeatable ×2, no-due-date path, determinism, injected `now`. This is the highest-value test surface.
- **Integration (Supertest + test DB):** create→list ordering (higher weight first); ownership isolation (user B can't see/modify user A's task); complete sets completed_at + 409 on repeat; defer options mutate correctly and insert deferral rows; archive hides task; validation errors; premium `weight_breakdown` present vs omitted.
