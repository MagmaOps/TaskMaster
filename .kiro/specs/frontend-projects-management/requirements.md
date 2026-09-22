# Frontend Projects Management — Requirements

## Introduction

This is the **third of four sequential frontend specs**. It builds the Projects page: viewing projects, creating them, editing (rename + recolor), deleting, and drag-and-drop reordering to set priority. It replaces the Projects placeholder route delivered by the app-shell spec, and reuses the Modal primitive, common components, and Toast surface already built. It consumes the feature-complete backend project API only; no backend changes.

The **Unassigned** (default) project is shown but is system-managed: not editable, not deletable, not reorderable, and it does not count toward the 20-project limit.

### Backend contract consumed (confirmed from source)

- `GET /api/projects` → `{ success, data: ProjectDTO[] }`, sorted by `priorityOrder` ASC (Unassigned first, `isDefault: true`). `ProjectDTO = { id, name, priorityOrder, isDefault, color, taskCount, createdAt }`.
- `POST /api/projects` → `{ success, data: ProjectDTO }` (201). Body: `name` (1–255), optional `color` (`#RRGGBB`). Errors: 409 `CONFLICT` (duplicate name, or the reserved name "unassigned"); 400 `VALIDATION_ERROR` when at the 20-project max.
- `PUT /api/projects/reorder` → `{ success, data: ProjectDTO[] }`. Body: `projectIds` — **exactly the full set of the user's Real_Projects (non-default), once each**, in the new order. 400 `VALIDATION_ERROR` if the set doesn't match (wrong size, dupes, unknown/default ids).
- `PUT /api/projects/:id` → `{ success, data: ProjectDTO }`. Body: `name?`, `color?`. Errors: 400 `VALIDATION_ERROR` if the target is the default project; 409 on duplicate/reserved name.
- `DELETE /api/projects/:id` → 204. 400 `VALIDATION_ERROR` if the target is the default. Deleting keeps the tasks (only project associations are removed; orphaned tasks fall back to Unassigned on the server).

## Glossary

- **Real project:** any non-default project the user created.
- **Unassigned:** the system default project (`isDefault: true`, `priorityOrder 0`), shown first and non-editable.
- **Reorder:** dragging real projects to change `priorityOrder` (top = highest priority).
- **Project limit:** max 20 real projects per user (Unassigned excluded).

## Requirements

### Requirement 1 — Project data layer (ProjectContext)

**User Story:** As a user, I want the app to load and manage my projects consistently, so that the Projects page and the task filter stay in sync.

#### Acceptance Criteria

1. THE app SHALL provide a `ProjectContext` exposing: `projects` (ProjectDTO[]), `status` (`idle` | `loading` | `ready` | `error`), `error`, and actions `loadProjects`, `createProject`, `updateProject`, `deleteProject`, `reorderProjects`.
2. WHEN the Projects page mounts (authenticated) THEN the context SHALL `GET /api/projects` and store the array in server order (Unassigned first).
3. WHEN a mutation succeeds THEN the context SHALL reconcile local state so the list reflects the change in correct order (re-fetch is acceptable; the server owns `priorityOrder`).
4. WHEN a project API call fails THEN the context SHALL surface a typed error and the UI SHALL show a friendly message; a failed mutation SHALL NOT leave the list inconsistent.
5. THE `useProjects` hook SHALL throw if used outside `ProjectProvider`.
6. THE Tasks-page filter (task-views spec) MAY consume this context instead of its own local fetch; if refactored, behavior SHALL be unchanged. (Optional cleanup, not required to change the task-views spec.)

### Requirement 2 — Projects list view

**User Story:** As a user, I want to see my projects in priority order with their task counts, so that I understand how my work is organized.

#### Acceptance Criteria

1. THE Projects page SHALL replace the placeholder Projects route and render the projects in server order (Unassigned first, then real projects by `priorityOrder`).
2. EACH project row SHALL show its name, a color swatch (when `color` set), and its task count.
3. THE Unassigned project SHALL be visually marked as the default and SHALL NOT show edit / delete / drag affordances.
4. WHILE projects are loading THE page SHALL show a loading state; on failure a friendly error with retry.
5. WHEN the user has no real projects THEN the page SHALL show an encouraging empty state (Unassigned still shown) with a call-to-action to create a project.
6. THE page SHALL be responsive down to 320px.

### Requirement 3 — Create project

**User Story:** As a user, I want to create a project, so that I can organize tasks by area of life.

#### Acceptance Criteria

1. THE Projects page SHALL provide a clearly labeled control to create a new project, opening a Create modal.
2. THE Create modal SHALL require a name (1–255 chars) and allow an optional color (`#RRGGBB`), with a small palette or color input.
3. WHEN submitted validly THEN the app SHALL `POST /api/projects`, close the modal, and the new project SHALL appear in the list.
4. WHEN the name duplicates an existing project OR equals the reserved "Unassigned" (case-insensitive) THEN the app SHALL show a friendly "a project with that name already exists" message (from the 409) without leaking codes.
5. WHEN the user is at the 20-project limit THEN the app SHALL show a friendly limit message (from the 400) and SHOULD proactively disable/□hint the create control when the real-project count is already 20.
6. THE modal SHALL validate client-side (non-empty name, color format if provided), be dismissible via cancel + Escape, and trap focus.

### Requirement 4 — Edit project (rename + recolor)

**User Story:** As a user, I want to rename or recolor a project, so that it reflects how I think about it.

#### Acceptance Criteria

1. EACH real project row SHALL offer an Edit affordance opening an Edit modal pre-filled with the current name and color.
2. WHEN submitted validly THEN the app SHALL `PUT /api/projects/:id` and reflect the change in the list.
3. WHEN the new name duplicates another project or the reserved name THEN the app SHALL show the friendly conflict message.
4. THE Unassigned project SHALL NOT be editable (no Edit affordance rendered).
5. THE Edit modal SHALL validate client-side, be dismissible via cancel + Escape, and trap focus.

### Requirement 5 — Delete project

**User Story:** As a user, I want to delete a project I no longer need, so that my list stays relevant, without losing my tasks.

#### Acceptance Criteria

1. EACH real project row SHALL offer a Delete affordance that asks for confirmation before deleting.
2. THE confirmation SHALL explain that deleting the project keeps its tasks (they return to Unassigned) and only removes the grouping.
3. WHEN confirmed THEN the app SHALL `DELETE /api/projects/:id` and remove the row from the list.
4. THE Unassigned project SHALL NOT be deletable (no Delete affordance rendered).
5. WHEN a delete fails THEN the app SHALL show a friendly error and leave the list unchanged.

### Requirement 6 — Drag-and-drop reorder

**User Story:** As a user, I want to drag projects to set their priority, so that higher projects boost their tasks' weight.

#### Acceptance Criteria

1. THE real projects SHALL be reorderable via drag-and-drop using `@dnd-kit`, with a visible drag handle (burger/☰) per row.
2. THE Unassigned project SHALL be pinned first and SHALL NOT participate in dragging (cannot be moved, and other projects cannot be dropped above it).
3. WHEN a drag completes with a new order THEN the app SHALL `PUT /api/projects/reorder` with the full ordered list of **real** project ids (excluding Unassigned) and reflect the server result.
4. THE reorder SHALL be keyboard-accessible (dnd-kit keyboard sensor) with appropriate ARIA announcements.
5. WHILE a reorder request is in flight THE UI MAY optimistically show the new order; on failure it SHALL revert to the server order and show a friendly error.
6. THE UI SHALL NOT display priority numbers; order alone conveys priority (top = highest).

### Requirement 7 — Feedback & consistency

**User Story:** As a user, I want clear feedback for project actions, so that I trust the app.

#### Acceptance Criteria

1. WHEN a create / edit / delete / reorder succeeds THEN the app MAY show a brief confirmation (toast) and SHALL keep the list consistent with the server.
2. WHEN any project action fails THEN the app SHALL show a friendly message derived from the error envelope with a sensible generic fallback.
3. Changes made here SHALL be reflected in the Tasks-page project filter the next time it loads (both read the same backend; no stale requirement beyond a re-fetch).

## Non-Goals

- Per-project analytics / completion stats (profile/settings spec).
- The project-priority global on/off toggle (a setting; profile/settings spec).
- Assigning tasks to projects from this page (that's in the task form, task-views spec).
- Changing the task-views spec's existing filter implementation (optional cleanup only).
- Bulk operations, project archiving, nested projects.

## Traceability to product docs

- Up to 20 projects, drag-and-drop reorder via burger icon, order implies priority (no numbers): PRD §3.3.
- Project priority weighting is auto-distributed and hidden: PRD §3.3, §4.
- Unassigned is system-managed (shown, non-editable): backend Unassigned revision (BUILD-STATE) + tech-spec.
- `@dnd-kit` for drag-and-drop: tech-spec §1.
- Components (ProjectList, ProjectCard, CreateProjectModal) + ProjectContext: tech-spec §6.1–6.3.
