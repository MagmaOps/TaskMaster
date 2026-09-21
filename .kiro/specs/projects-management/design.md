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

## Revision: Unassigned Project (added)

Implements Requirements 8-12: a per-user **Unassigned** project (a real `projects` row flagged `is_default`) that transparently owns any task with no Real_Project. It is protected (no delete/rename/recolor/reorder), excluded from the 20-max and from weight distribution (multiplier 0), and holds a task exactly when the task has no Real_Project. This makes "unassigned" a concrete membership so per-project reads (analytics, task-count) need no special case.

### Migration `1000000000005_default_project`

Up:

- Add `projects.is_default boolean NOT NULL DEFAULT false`.
- Relax the priority_order CHECK from `>= 1 AND <= 20` to `>= 0 AND <= 20` (drop + re-add the constraint), so the Unassigned row can sit at `priority_order = 0` outside the user-reorderable 1-20 range.
- Add a partial unique index `uq_projects_one_default ON projects (user_id) WHERE is_default` — at most one Unassigned per user.
- Backfill: `INSERT INTO projects (user_id, name, priority_order, is_default) SELECT id, 'Unassigned', 0, true FROM users` (one per existing user).
- Backfill memberships: for every task with no `task_projects` row, link it to its owner's Unassigned project — a single `INSERT INTO task_projects (task_id, project_id) SELECT t.id, dp.id FROM tasks t JOIN projects dp ON dp.user_id = t.user_id AND dp.is_default WHERE NOT EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id)`.

Down (reversible):

- Delete `task_projects` rows that reference `is_default` projects, then delete the `is_default` projects, drop the partial unique index, and restore the CHECK to `>= 1 AND <= 20`, then drop the `is_default` column.

The existing `uq_projects_user_priority` unique index still holds: Unassigned uses order 0, Real_Projects 1-20, so no collision. (Order 0 is unique per user because there is one Unassigned per user.)

## Data Models

### Types (revision)

- `ProjectRow` gains `is_default: boolean`.
- `ProjectDTO` gains `isDefault: boolean` (Req 12.2).
- `ProjectWithCount` inherits `is_default` from `ProjectRow`.

### projectRepository changes

- `ensureDefault(userId): ProjectRow` — idempotent insert of the Unassigned row: `INSERT INTO projects (user_id, name, priority_order, is_default) VALUES ($1, 'Unassigned', 0, true) ON CONFLICT (user_id) WHERE is_default DO NOTHING RETURNING *`; when the conflict skips the insert, SELECT and return the existing row. (Req 8.1, 8.4)
- `getDefault(userId): ProjectRow` — SELECT the `is_default` row for the user.
- `listForUserWithCounts` — unchanged query but now also returns `is_default`; ordering by `priority_order ASC` already puts Unassigned (0) first (Req 12.1, 12.3).
- `listForUser` (weight helper) — now returns `{ id, priority_order, is_default }` so the weight path can exclude the Unassigned project.
- `countForUser` — used for the 20-max; add `AND is_default = false` so Unassigned is not counted (Req 11.1). (Rename intent: the limit counts Real_Projects only.)
- `findByIdForUser` — returns `is_default` so the service can guard mutations.
- `reorder` — operates only on the provided Real_Project ids; the Unassigned row (order 0) is never in the set and is untouched (Req 10.4).
- New membership helpers used by task-management (in taskRepository, see below), not here.

### projectService changes

- `createProject`: name-uniqueness now also rejects the reserved name `'Unassigned'` (case-insensitive) → 409 (Req 12.4); 20-max uses the Real_Project-only count (Req 11.1).
- `updateProject`: if the target row `is_default`, reject with 400 (no rename/recolor of Unassigned, Req 10.2); also reject renaming a Real_Project to `'Unassigned'` (Req 12.4).
- `deleteProject`: if the target row `is_default`, reject with 400 and do not delete (Req 10.1).
- `reorderProjects`: the required id set is exactly the user's Real_Projects (exclude `is_default` from the "current set" it validates against); if the payload contains the Unassigned id or does not match the Real_Project set → 400 (Req 10.3).
- `listProjects`: maps `is_default` → `isDefault` in the DTO (Req 12.2).

### Task-management integration (membership auto-management)

The exclusive Unassigned membership (Req 9) is enforced in the `taskRepository` create/update transactions, where project associations are already written:

- **create**: after inserting the task, if `projectIds` is empty/absent, link the owner's Unassigned project; otherwise link the given Real_Projects only (Req 9.1, 9.2).
- **update**: when `projectIds` is provided, the existing code replaces the associations. After computing the new set: if it is empty, link Unassigned; if non-empty, link the Real_Projects and ensure no Unassigned membership remains (Req 9.3, 9.4). Because associations are replaced wholesale in one transaction, exclusivity (Req 9.6) holds naturally.
- A small repo helper `linkDefault(client, userId, taskId)` resolves the user's Unassigned id and inserts the `task_projects` row (ON CONFLICT DO NOTHING).

`taskService` guards client input (Req 9.5): in `createTask`/`updateTask`, `projectRepo.assertOwned` already validates ownership; extend it (or add a check) to reject a `projectIds` array that contains an `is_default` project id with 400 (the Unassigned membership is system-managed). `assertOwned` will be tightened to fail when any provided id is a default project.

### Weight algorithm integration (multiplier 0)

Requirement 11.2/11.3: the Unassigned project must not affect weight, and must be excluded from the auto-distribution.

- `taskService.loadUserWeightContext` builds `orderById` and `totalProjects` from `projectRepo.listForUser`. Change: **exclude `is_default` projects** from both `orderById` and `totalProjects`, so the distribution denominator and the highest-priority pick see Real_Projects only.
- `buildWeightInput` picks the best (lowest) `priority_order` among the task's projects using `orderById`. Because the Unassigned project is absent from `orderById`, a task whose only membership is Unassigned yields `projectPriorityOrder = null` → the weight multiplier block is skipped → weight unchanged (exactly today's "no project" behavior). This realizes multiplier 0 without changing `weight.ts` itself.
- Guard: if a task somehow has both (should not happen), the Unassigned order is simply not in `orderById`, so only Real_Projects influence the pick. No `weight.ts` change is required.

### User creation integration

Requirement 8.1: every new user gets an Unassigned project. `authService.register` and `authService` Google new-user path call `projectRepo.ensureDefault(user.id)` immediately after the user row is created. Because `ensureDefault` is idempotent (Req 8.4), it is safe if called more than once. (Alternatively `createPasswordUser`/`createOAuthUser` could create it in the same transaction; the design keeps it in `authService` to avoid a projects dependency inside `userRepository`, matching the existing separation. Migration handles all pre-existing users, Req 8.3.)

## Correctness Properties

*A property is a characteristic that holds across all valid executions.*

### Property 1: Unassigned membership is exclusive and total

*For any* task, its project set is either one-or-more Real_Projects (and no Unassigned membership) or exactly the Unassigned project (when it has no Real_Project) — never both, and never empty.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.6**

### Property 2: Unassigned is weight-neutral

*For any* task whose only membership is the Unassigned project, its computed weight equals the weight of an otherwise-identical task with no project at all (the multiplier block is skipped), and the presence of the Unassigned project never changes any Real_Project task weight.

**Validates: Requirements 11.2, 11.3, 11.4**

### Testing Strategy (revision)

Existing projects/tasks suites must stay green after the changes (the weight-ordering and project-count tests especially, since membership now always exists). New coverage:

- **Migration/backfill:** after migrate, every existing user has exactly one `is_default` project and every previously-unassociated task links to it (verified in an integration test that seeds a user + orphan task before relying on the running migration state, or asserts the invariant on a fresh migrated DB).
- **User creation:** registering (password + Google) creates exactly one Unassigned project for the new user; `ensureDefault` called twice yields one row (idempotent).
- **Exclusive membership:** create task with no projects → in Unassigned only; create with a Real_Project → not in Unassigned; update to empty set → moves to Unassigned; update to a Real_Project → Unassigned membership removed; never both (Req 9).
- **Client cannot assign Unassigned:** passing the Unassigned id in `projectIds` on create/update → 400 (Req 9.5).
- **Protection:** delete Unassigned → 400; rename/recolor Unassigned → 400; reorder including the Unassigned id → 400; reorder of Real_Projects leaves Unassigned at order 0 (Req 10).
- **Limits/weighting:** 20-max counts Real_Projects only (create 20 real + Unassigned still present); a task in only Unassigned has the same weight as a genuinely project-less task (multiplier skipped); adding the Unassigned project does not change a Real_Project task's weight/distribution (Req 11).
- **List/DTO:** GET /api/projects includes Unassigned first with `isDefault: true`; Real_Projects `isDefault: false`; taskCount correct; reserved-name create/rename to "Unassigned" → 409 (Req 12).
- **Property (optional):** for a random set of Real_Project assignments per task, exactly one of {>=1 Real_Project, Unassigned-only} holds — membership is always non-empty and Unassigned iff no Real_Project.

### Requirement-to-section map (revision)

| Requirement | Design coverage |
| --- | --- |
| 8 One Unassigned per user | Migration; ensureDefault; user-creation integration |
| 9 Exclusive/auto membership | taskRepository create/update; linkDefault; assertOwned guard |
| 10 Protection | projectService update/delete/reorder guards |
| 11 Limits & weighting | countForUser filter; loadUserWeightContext exclusion |
| 12 List & DTO | listForUserWithCounts + isDefault; reserved name |

