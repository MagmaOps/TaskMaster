# Requirements Document

## Introduction

Projects are an optional organizational layer over tasks. A user can create up to 20 projects, order them by priority (drag-and-drop), assign tasks to one or more projects, and filter their task list by project. Project order feeds the **weight algorithm's project multiplier** (already implemented in task-management): the top project boosts its tasks most, the bottom least. The multiplier itself is hidden from users — they just reorder.

This spec provides the full `projectRepository` that supersedes the temporary `projectReadRepository` created during task-management. It builds on the existing `projects` and `task_projects` tables (migration `1000000000001`) and aligns with `docs/technical-specification.md` §5.5.

## Glossary

- **Project**: A row in `projects` owned by a user: `name`, `priority_order` (1–20, lower = higher priority), optional `color`.
- **Priority Order**: The 1-based rank of a project among the user's projects; determines the weight multiplier. Contiguous and unique per user (1,2,3,…).
- **Reorder**: Replacing the full priority ordering of a user's projects from a client-provided ordered list of ids.
- **Task Count**: Number of the user's active (not completed, not archived) tasks associated with a project.
- **Project Priority Toggle**: The user setting `project_priority_enabled` that turns the weight multiplier on/off globally (already consumed by the weight algorithm).

## Requirements

### Requirement 1: Create projects

**User Story:** As a user, I want to create a project, so that I can group related tasks.

#### Acceptance Criteria
1. WHEN a user POSTs a project with a non-empty `name`, THE system SHALL create it owned by the authenticated user and return it.
2. THE system SHALL require `name` (1–255 chars) and accept an optional `color` (hex `#RRGGBB`).
3. WHEN the user already has 20 projects, THE system SHALL reject creation with 400 and a clear "maximum of 20 projects" message.
4. WHEN the `name` duplicates an existing project of that user (case-insensitive), THE system SHALL reject with 409 "A project with this name already exists".
5. WHEN a project is created, THE system SHALL assign it the next available `priority_order` (append to the end = lowest priority).
6. THE system SHALL initialize `task_count` to 0 in the response.

### Requirement 2: List projects

**User Story:** As a user, I want to see my projects in priority order with their task counts.

#### Acceptance Criteria
1. WHEN a user GETs their projects, THE system SHALL return only their own projects, sorted by `priority_order` ascending (top = highest priority).
2. THE system SHALL include for each project: id, name, priorityOrder, color, taskCount, createdAt.
3. THE system SHALL compute `taskCount` as the number of the user's active tasks associated with that project.
4. WHEN the user has no projects, THE system SHALL return an empty array.

### Requirement 3: Update projects

**User Story:** As a user, I want to rename a project or change its color.

#### Acceptance Criteria
1. WHEN a user PUTs changes to their own project (`name` and/or `color`), THE system SHALL apply them and return the updated project.
2. WHEN the new `name` duplicates another of the user's projects (case-insensitive), THE system SHALL reject with 409.
3. THE system SHALL NOT change `priority_order` via this endpoint (ordering is only changed by reorder).
4. WHEN the project does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 4: Reorder projects (drag-and-drop)

**User Story:** As a user, I want to drag projects into my preferred order, so that higher projects boost their tasks more.

#### Acceptance Criteria
1. WHEN a user PUTs a reorder request with an ordered array of project ids, THE system SHALL set each project's `priority_order` to its 1-based index in that array.
2. THE system SHALL require the array to contain exactly the user's full set of project ids (no missing, no extra, no duplicates); otherwise 400.
3. THE system SHALL perform the reorder atomically so the unique `(user_id, priority_order)` constraint is never violated mid-update.
4. WHEN reorder succeeds, THE system SHALL return the projects in the new order.
5. WHEN any id does not belong to the user, THE system SHALL return 400.

### Requirement 5: Delete projects

**User Story:** As a user, I want to delete a project without losing my tasks.

#### Acceptance Criteria
1. WHEN a user deletes their own project, THE system SHALL remove it and its `task_projects` associations (tasks themselves are NOT deleted), then return 204.
2. WHEN a project is deleted, THE system SHALL close the gap in `priority_order` so remaining projects stay contiguous (1,2,3,…).
3. WHEN the project does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 6: Integration with tasks and weighting

**User Story:** As a user, I want project priority to influence which tasks surface first.

#### Acceptance Criteria
1. THE system SHALL expose project data (id + priority_order, and counts) such that the weight algorithm can apply the project multiplier using the highest-priority project a task belongs to. (Already consumed by task-management.)
2. THE `projectRepository` SHALL provide the read helpers previously in `projectReadRepository` (`listForUser` returning id+priority_order, `assertOwned`), and task-management SHALL use the unified repository.
3. WHEN project priority weighting is toggled off via user settings, THE system SHALL still allow projects and filtering, and the weight algorithm SHALL ignore the multiplier (existing behavior).

### Requirement 7: Ownership, validation, and errors

**User Story:** As a user, I want project endpoints to be authenticated, validated, and scoped to me, so that my project data stays private and consistent.

#### Acceptance Criteria
1. THE system SHALL require a valid access token on all project endpoints and scope every operation to the authenticated user.
2. THE system SHALL validate inputs (name length, color hex format, reorder array of UUIDs) and return 400 `VALIDATION_ERROR` with details on failure.
3. THE system SHALL use the standard success/error envelopes and parameterized queries.
4. THE system SHALL enforce the 20-project maximum and the case-insensitive name uniqueness per user.

## Revision: Unassigned Project (added)

This revision introduces a per-user **Unassigned** project: a real `projects` row (flagged `is_default`) that owns every task not assigned to any real project. It cannot be deleted, renamed, recolored, or reordered; it never affects task weight (its project multiplier is 0); it is excluded from the 20-project maximum; and it holds a task exactly when that task has no real project. It replaces the former notion of "unassigned" (no `task_projects` row) with a concrete membership, so downstream per-project features (e.g. analytics) need no special-casing.

### Revision Glossary

- **Unassigned_Project**: The per-user `projects` row with `is_default = true`, `name = 'Unassigned'`, `priority_order = 0`. Exactly one per user.
- **Real_Project**: Any project with `is_default = false` (the user-created projects, `priority_order` 1-20).
- **Unassigned_Membership**: A `task_projects` row linking a task to its owner's Unassigned_Project. A task has this membership exactly when it has zero Real_Project memberships.

### Requirement 8: Every user has exactly one Unassigned project

**User Story:** As a user, I want a permanent home for tasks I have not filed under a project, so that nothing is ever truly project-less.

#### Acceptance Criteria

1. WHEN a new user account is created (email/password or Google), THE system SHALL create an Unassigned_Project for that user with `is_default = true`, `name = 'Unassigned'`, and `priority_order = 0`.
2. THE system SHALL guarantee at most one Unassigned_Project per user (enforced by a partial unique index on `(user_id) WHERE is_default`).
3. WHEN the projects schema is migrated, THE system SHALL create an Unassigned_Project for every existing user and link every existing task that has no `task_projects` association to its owner's Unassigned_Project.
4. THE system SHALL create the Unassigned_Project idempotently, so creating it when one already exists neither errors nor produces a duplicate.

### Requirement 9: Unassigned membership is exclusive and automatic

**User Story:** As a user, I want a task to sit in Unassigned only until I file it under a real project, so that it is never in both.

#### Acceptance Criteria

1. WHEN a task is created with no Real_Project ids, THE system SHALL link it to the Unassigned_Project.
2. WHEN a task is created with one or more Real_Project ids, THE system SHALL link it only to those Real_Projects and NOT to the Unassigned_Project.
3. WHEN a task is updated so its Real_Project set becomes empty, THE system SHALL link it to the Unassigned_Project.
4. WHEN a task is updated so it has one or more Real_Projects, THE system SHALL remove any Unassigned_Membership so the task is never in both.
5. THE system SHALL reject any client attempt to pass the Unassigned_Project's id in a task's project id list (the Unassigned membership is system-managed, not client-assignable), returning 400.
6. WHERE a task has an Unassigned_Membership, THE system SHALL ensure that is its only project association.

### Requirement 10: Unassigned is protected from mutation

**User Story:** As a user, I want the Unassigned project to always be there and unchangeable, so that my project structure has a stable fallback.

#### Acceptance Criteria

1. WHEN a user attempts to delete the Unassigned_Project, THE system SHALL reject it with 400 and a clear message, and SHALL NOT delete it.
2. WHEN a user attempts to rename or recolor the Unassigned_Project (PUT /:id), THE system SHALL reject it with 400 and SHALL NOT modify it.
3. WHEN a user submits a reorder request, THE system SHALL require the ordered id set to be exactly the user's Real_Projects (the Unassigned_Project MUST NOT appear); otherwise 400.
4. THE system SHALL keep the Unassigned_Project at `priority_order = 0` and SHALL NOT change it during any reorder.

### Requirement 11: Unassigned excluded from limits and weighting

**User Story:** As a user, I want the Unassigned project to be organizational only, so that it never uses up my project budget or changes how tasks are prioritized.

#### Acceptance Criteria

1. WHEN enforcing the 20-project maximum, THE system SHALL count only Real_Projects; the Unassigned_Project SHALL NOT count toward the limit.
2. WHEN computing a task's weight, THE system SHALL treat the Unassigned_Project as contributing a project multiplier of 0 (i.e. `weight * (1 + 0)` = weight unchanged).
3. WHEN computing the project multiplier's auto-distribution across a user's projects, THE system SHALL exclude the Unassigned_Project from the project count and from the highest-priority-project selection, so a task in only the Unassigned_Project weighs exactly as if it had no project.
4. THE system SHALL NOT let the Unassigned_Project affect the multiplier of any Real_Project (its presence changes no Real_Project's distribution).

### Requirement 12: Unassigned in the projects list

**User Story:** As a user, I want to see and filter by Unassigned like any project, while knowing it is special.

#### Acceptance Criteria

1. WHEN a user GETs their projects, THE system SHALL include the Unassigned_Project, ordered first (its `priority_order = 0` sorts ahead of Real_Projects).
2. WHEN returning the Unassigned_Project, THE system SHALL include an `isDefault: true` marker in its DTO so clients can render it as non-editable; Real_Projects SHALL carry `isDefault: false`.
3. THE system SHALL compute the Unassigned_Project's `taskCount` the same way as Real_Projects (active tasks associated with it).
4. WHERE name uniqueness is enforced, THE system SHALL treat `'Unassigned'` as a reserved name a user cannot create or rename a Real_Project to (case-insensitive), returning 409.

