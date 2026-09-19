# Projects Management Design

## Overview

Implements `requirements.md`: project CRUD, drag-and-drop reorder, task-count listing, and deletion with contiguous re-ranking. Same layering as auth/tasks (routes → controller → service → repository), reusing the DB pool, `ApiError`, `authMiddleware`, and `validate`.

A key deliverable is a **full `projectRepository`** that replaces the temporary `projectReadRepository`. Task-management's imports are updated to the new repository, and the old file is deleted (no waste files).

No new migrations — `projects` and `task_projects` already exist (migration `1000000000001`) with: `projects(id, user_id, name, priority_order 1–20 CHECK, color, timestamps)`, unique `(user_id,name)` and unique `(user_id,priority_order)`.

## Architecture

```
authMiddleware → projectRoutes → validate → projectController → projectService → projectRepository
                                                                                    (projects, task_projects, task counts)
```

## Concurrency & ordering strategy

The unique `(user_id, priority_order)` constraint makes naive reordering fragile (temporary collisions). All order-mutating operations run inside a single transaction and use one of these safe patterns:

- **Create**: `next_order = COALESCE(MAX(priority_order),0)+1` for the user (within the transaction), then insert. Enforce the 20-max first.
- **Reorder**: validate the id set equals the user's set, then update all rows to their new order in one statement using a `VALUES`-based mapping and a **deferred-safe** two-phase approach: shift to a non-colliding temporary range (e.g. `priority_order = priority_order + 1000`) then set final values — OR update via a single `UPDATE ... FROM (VALUES ...)` after temporarily removing collisions. We use the offset approach for clarity: phase 1 sets `priority_order = -rownum` (negative, collision-free), phase 2 sets final positive values.
- **Delete**: delete the row, then `UPDATE projects SET priority_order = priority_order - 1 WHERE user_id=$1 AND priority_order > $deletedOrder` to close the gap, all in one transaction.

Case-insensitive name uniqueness is enforced in the service via `LOWER(name)` comparison (the DB unique index is case-sensitive; the service check covers case-insensitivity and returns the friendly 409).

## Components and Interfaces

### projectRepository (`src/repositories/projectRepository.ts`) — supersedes projectReadRepository
- `listForUserWithCounts(userId): ProjectWithCount[]` — projects + active task counts (LEFT JOIN task_projects → tasks filtered active), ordered by priority_order.
- `listForUser(userId): { id, priority_order }[]` — lightweight, for weighting (same signature the weight path already uses).
- `countForUser(userId): number`
- `findByIdForUser(userId, id): ProjectRow | null`
- `findByNameForUser(userId, name): ProjectRow | null` — case-insensitive.
- `create(userId, { name, color }): ProjectRow` — assigns next priority_order (transactional).
- `update(userId, id, { name?, color? }): ProjectRow | null`
- `reorder(userId, orderedIds): ProjectRow[]` — transactional two-phase re-rank.
- `remove(userId, id): boolean` — delete + close gap (transactional); associations cascade via FK.
- `assertOwned(userId, projectIds): void` — unchanged behavior from the temporary repo.

### projectService (`src/services/projects/projectService.ts`)
- `create`: enforce 20-max (`countForUser`), case-insensitive name uniqueness, create, return DTO (taskCount 0).
- `list`: `listForUserWithCounts` → DTOs.
- `update`: ownership check, name-uniqueness (excluding self), apply, return DTO.
- `reorder`: validate the provided id array equals the user's set (size + membership) → `reorder` → DTOs.
- `remove`: ownership check → `remove`.

### projectController + projectRoutes
Mounted at `/api/projects` behind `authMiddleware`. Routes:
- `GET    /api/projects` → 200 `{ data: Project[] }`
- `POST   /api/projects` → 201 `{ data: Project }`
- `PUT    /api/projects/reorder` → 200 `{ data: Project[] }` body `{ projectIds: string[] }`  (declared before `/:id` to avoid route capture)
- `PUT    /api/projects/:id` → 200 `{ data: Project }`
- `DELETE /api/projects/:id` → 204

`Project` DTO: `{ id, name, priorityOrder, color, taskCount, createdAt }`.

## Task-management integration (refactor)
- Replace `import * as projectRead from '../repositories/projectReadRepository'` in `taskService.ts` with the unified `projectRepository` (`listForUser`, `assertOwned` keep the same signatures).
- Delete `src/repositories/projectReadRepository.ts`.
- Re-run the full test suite to confirm task-management still passes after the swap.

## Error Handling
Reuses `ApiError`: `VALIDATION_ERROR` (400, incl. 20-max and bad reorder set), `CONFLICT` (409 duplicate name), `NOT_FOUND` (404 wrong/absent owner).

## Testing Strategy
- **Unit (service, mocked repo):** 20-max rejection; duplicate-name (case-insensitive) rejection on create + update; reorder set-mismatch rejection.
- **Integration (Supertest + test DB):**
  - create → appears with next priority_order and taskCount 0
  - list ordered by priority_order with correct taskCount (assign a task to a project, expect count 1; complete it, expect 0)
  - 20-max enforced (create 20 ok, 21st → 400)
  - duplicate name → 409 (create + rename)
  - reorder changes order and stays contiguous; wrong set → 400
  - delete removes project, closes the gap, leaves the task intact (task still exists, just unassigned)
  - ownership isolation (user B cannot see/update/delete user A's project → 404)
  - reorder affects task weight ordering (assign two tasks to two projects, reorder, confirm top project's task outweighs the other) — validates the integration with the weight multiplier
