# Projects Management Requirements

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

### Requirement 1 — Create projects

**User Story:** As a user, I want to create a project, so that I can group related tasks.

#### Acceptance Criteria
1. WHEN a user POSTs a project with a non-empty `name`, THE system SHALL create it owned by the authenticated user and return it.
2. THE system SHALL require `name` (1–255 chars) and accept an optional `color` (hex `#RRGGBB`).
3. WHEN the user already has 20 projects, THE system SHALL reject creation with 400 and a clear "maximum of 20 projects" message.
4. WHEN the `name` duplicates an existing project of that user (case-insensitive), THE system SHALL reject with 409 "A project with this name already exists".
5. WHEN a project is created, THE system SHALL assign it the next available `priority_order` (append to the end = lowest priority).
6. THE system SHALL initialize `task_count` to 0 in the response.

### Requirement 2 — List projects

**User Story:** As a user, I want to see my projects in priority order with their task counts.

#### Acceptance Criteria
1. WHEN a user GETs their projects, THE system SHALL return only their own projects, sorted by `priority_order` ascending (top = highest priority).
2. THE system SHALL include for each project: id, name, priorityOrder, color, taskCount, createdAt.
3. THE system SHALL compute `taskCount` as the number of the user's active tasks associated with that project.
4. WHEN the user has no projects, THE system SHALL return an empty array.

### Requirement 3 — Update projects

**User Story:** As a user, I want to rename a project or change its color.

#### Acceptance Criteria
1. WHEN a user PUTs changes to their own project (`name` and/or `color`), THE system SHALL apply them and return the updated project.
2. WHEN the new `name` duplicates another of the user's projects (case-insensitive), THE system SHALL reject with 409.
3. THE system SHALL NOT change `priority_order` via this endpoint (ordering is only changed by reorder).
4. WHEN the project does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 4 — Reorder projects (drag-and-drop)

**User Story:** As a user, I want to drag projects into my preferred order, so that higher projects boost their tasks more.

#### Acceptance Criteria
1. WHEN a user PUTs a reorder request with an ordered array of project ids, THE system SHALL set each project's `priority_order` to its 1-based index in that array.
2. THE system SHALL require the array to contain exactly the user's full set of project ids (no missing, no extra, no duplicates); otherwise 400.
3. THE system SHALL perform the reorder atomically so the unique `(user_id, priority_order)` constraint is never violated mid-update.
4. WHEN reorder succeeds, THE system SHALL return the projects in the new order.
5. WHEN any id does not belong to the user, THE system SHALL return 400.

### Requirement 5 — Delete projects

**User Story:** As a user, I want to delete a project without losing my tasks.

#### Acceptance Criteria
1. WHEN a user deletes their own project, THE system SHALL remove it and its `task_projects` associations (tasks themselves are NOT deleted), then return 204.
2. WHEN a project is deleted, THE system SHALL close the gap in `priority_order` so remaining projects stay contiguous (1,2,3,…).
3. WHEN the project does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 6 — Integration with tasks and weighting

**User Story:** As a user, I want project priority to influence which tasks surface first.

#### Acceptance Criteria
1. THE system SHALL expose project data (id + priority_order, and counts) such that the weight algorithm can apply the project multiplier using the highest-priority project a task belongs to. (Already consumed by task-management.)
2. THE `projectRepository` SHALL provide the read helpers previously in `projectReadRepository` (`listForUser` returning id+priority_order, `assertOwned`), and task-management SHALL use the unified repository.
3. WHEN project priority weighting is toggled off via user settings, THE system SHALL still allow projects and filtering, and the weight algorithm SHALL ignore the multiplier (existing behavior).

### Requirement 7 — Ownership, validation, and errors

#### Acceptance Criteria
1. THE system SHALL require a valid access token on all project endpoints and scope every operation to the authenticated user.
2. THE system SHALL validate inputs (name length, color hex format, reorder array of UUIDs) and return 400 `VALIDATION_ERROR` with details on failure.
3. THE system SHALL use the standard success/error envelopes and parameterized queries.
4. THE system SHALL enforce the 20-project maximum and the case-insensitive name uniqueness per user.
