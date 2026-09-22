# Frontend Task Views / "What's Next?" — Requirements

## Introduction

This is the **second of four sequential frontend specs**. It builds the core value surface of TaskMaster inside the app shell delivered by the app-shell + auth spec: the weight-sorted task list with the prominent "What's Next?" top task, ultra-fast task capture (Quick-Add), the tap-to-act flow (complete / defer / modify / archive / delete), the guilt-free deferral options, a project filter, Focus Mode, and celebration toasts when a completion unlocks achievements.

It consumes the existing, feature-complete backend task API only. No backend changes.

### Backend contract consumed (confirmed from source)

- `GET /api/tasks?project_id=<uuid>&include_completed=<bool>` → `{ success, data: TaskDTO[] }`, already **weight-sorted highest-first** by the server.
- `POST /api/tasks` → `{ success, data: TaskDTO }` (201). Body: `subject` (1–500), `priority` (`high|medium|low`), optional `dueDate` (`YYYY-MM-DD`), `dueTime` (`HH:MM`), `projectIds` (uuid[]), `isRepeatable` (bool), `repeatPattern` ({ frequency: 'daily'|'weekly', interval?, days_of_week?: number[0-6], end_date?: string|null }).
- `PUT /api/tasks/:id` → `{ success, data: TaskDTO }`. Same optional fields as create.
- `PUT /api/tasks/:id/complete` → `{ success, data: TaskDTO & { weightAtCompletion: number; unlocked: UnlockedAchievement[] } }`. `UnlockedAchievement = { type: string; data?: Record<string, unknown> }`.
- `PUT /api/tasks/:id/defer` → `{ success, data: TaskDTO }`. Body: `option` ∈ `later_today | tomorrow | sometime_later`.
- `DELETE /api/tasks/:id` → 204 (soft archive).
- `GET /api/projects` → `{ success, data: ProjectDTO[] }` where `ProjectDTO = { id, name, priorityOrder, isDefault, color, taskCount, createdAt }`, sorted by `priorityOrder` (Unassigned first, `isDefault: true`).

**TaskDTO** = `{ id, subject, priority, dueDate, dueTime, isRepeatable, repeatPattern, createdAt, completedAt, projects: { id, name, priorityOrder, color }[], deferralCount, weight, weightBreakdown? }`. `weightBreakdown` is present only for premium users with weight visibility enabled.

## Glossary

- **What's Next?:** the single highest-weight active task, shown prominently at the top.
- **Active task:** not completed, not archived.
- **Quick-Add:** the modal opened by the center + button for fast task capture.
- **Action modal:** the modal shown when a task card is tapped (Complete / Later / Modify / Archive / Delete).
- **Deferral modal:** the sub-modal with the three "Later" options.
- **Focus Mode:** a setting that shows only the top task and hides the rest of the list.
- **Celebration toast:** a friendly toast shown when a completion returns unlocked achievements.

## Requirements

### Requirement 1 — Task data layer (TaskContext)

**User Story:** As a user, I want the app to load and manage my tasks, so that the views always reflect current server state.

#### Acceptance Criteria

1. THE app SHALL provide a `TaskContext` exposing: `tasks` (TaskDTO[]), `status` (`idle` | `loading` | `ready` | `error`), the active `filterProjectId` (string | null for "All"), and actions `loadTasks`, `setFilterProjectId`, `createTask`, `updateTask`, `completeTask`, `deferTask`, `archiveTask`.
2. WHEN the task views mount (authenticated) THEN `TaskContext` SHALL call `GET /api/tasks` with the current filter and store the returned array in server order (no client re-sort).
3. THE context SHALL request active tasks only (`include_completed=false`) for the main list in this spec.
4. WHEN `filterProjectId` changes THEN the context SHALL re-fetch with `project_id` set (omitted for "All").
5. WHEN a mutation (`createTask`, `updateTask`, `completeTask`, `deferTask`, `archiveTask`) succeeds THEN the context SHALL reconcile local state so the list reflects the change and remains in correct weight order (re-fetch is acceptable, since the server computes weight and order).
6. WHEN a task API call fails THEN the context SHALL surface a typed error and the UI SHALL show a friendly message; a failed mutation SHALL NOT leave the list in an inconsistent state.
7. THE `useTasks` hook SHALL throw if used outside `TaskProvider`.

### Requirement 2 — Task list view & "What's Next?"

**User Story:** As a user, I want to open the app and immediately see the one thing to do next, so that I can start working without planning.

#### Acceptance Criteria

1. THE Tasks page SHALL render the highest-weight active task as a prominent, visually dominant "What's Next?" card above the rest.
2. THE remaining active tasks SHALL render below in a scrollable list in the server-provided (weight) order.
3. EACH task card SHALL show subject, a priority badge (high/medium/low), due date/time when set, project tag(s) when assigned, and a repeatable indicator when `isRepeatable`.
4. THE weight number SHALL NOT be displayed for free users; IF `weightBreakdown` is present (premium + enabled) THEN a breakdown MAY be surfaced, otherwise no weight value is shown. (Detailed premium breakdown UI is deferred to the profile/settings spec; this spec only avoids leaking weight.)
5. WHILE tasks are loading THE page SHALL show a loading state; WHEN loading fails THE page SHALL show a friendly error with a retry action.
6. WHEN the user has no active tasks THEN the page SHALL show an encouraging empty state with a call-to-action to add a task (zero empty states principle).
7. THE list SHALL be responsive down to 320px and the top task SHALL remain visually distinct at all sizes.

### Requirement 3 — Quick-Add task capture

**User Story:** As a user, I want to capture a task in seconds, so that nothing is lost and I stay in flow.

#### Acceptance Criteria

1. WHEN the center + button in the bottom nav is activated THEN the app SHALL open the Quick-Add modal (this spec wires the previously-placeholder + button).
2. THE Quick-Add modal SHALL auto-focus the subject input on open.
3. THE modal SHALL require subject (1–500 chars) and priority, with priority **defaulting to medium**; due date, due time, project multi-select, and repeatable toggle SHALL be optional and collapsed by default.
4. WHEN repeatable is enabled THEN the modal SHALL allow choosing a pattern (daily, or weekly with selected days) mapped to the backend `repeatPattern` shape.
5. WHEN the form is submitted validly THEN the app SHALL `POST /api/tasks`, close the modal, and the new task SHALL appear in the list at its correct weight position.
6. WHEN submission fails validation client-side THEN the modal SHALL show field errors and SHALL NOT submit.
7. WHEN submission fails server-side THEN the modal SHALL show a friendly error and preserve the entered values.
8. THE modal SHALL be dismissible via a cancel control and the Escape key, and SHALL trap focus while open.

### Requirement 4 — Action modal (tap a task)

**User Story:** As a user, I want to tap a task and choose what to do with it, so that acting on a task is one tap away.

#### Acceptance Criteria

1. WHEN a task card is tapped/activated THEN the app SHALL open an Action modal for that task offering: Complete, Later (opens the Deferral modal), Modify, Archive, and Delete.
2. WHEN Complete is chosen THEN the app SHALL `PUT /api/tasks/:id/complete`, remove the task from the active list, and (if the response `unlocked` array is non-empty) trigger celebration toasts (Req 7).
3. WHEN Modify is chosen THEN the app SHALL open the task form pre-filled with the task's current values and `PUT /api/tasks/:id` on save.
4. WHEN Archive or Delete is chosen THEN the app SHALL `DELETE /api/tasks/:id` (soft archive) and remove it from the list; a destructive Delete SHALL ask for confirmation.
5. THE Action modal SHALL be keyboard-accessible, dismissible via Escape and a close control, and SHALL trap focus while open.
6. WHILE a task action is in flight THE relevant control SHALL show a pending state and prevent duplicate submissions.

### Requirement 5 — Deferral ("Accountable Procrastination")

**User Story:** As a user, I want guilt-free ways to say "later", so that postponing is normal and tracked positively.

#### Acceptance Criteria

1. WHEN Later is chosen from the Action modal THEN the app SHALL present the three options: Later Today, Tomorrow, Sometime Later — with friendly, non-judgmental copy.
2. WHEN an option is chosen THEN the app SHALL `PUT /api/tasks/:id/defer` with the matching `option` (`later_today` | `tomorrow` | `sometime_later`) and update the list to reflect the server result.
3. THE deferral options SHALL be clearly labeled with their effect (e.g. "Sometime Later" lowers priority and clears the due date) without exposing weight numbers.
4. WHEN a deferral succeeds THEN the modal(s) SHALL close and the list SHALL reflect the new order/state.
5. WHEN a deferral fails THEN the app SHALL show a friendly error and leave the task unchanged.

### Requirement 6 — Project filter & Focus Mode

**User Story:** As a user, I want to filter by project and optionally see only my top task, so that I can narrow focus.

#### Acceptance Criteria

1. THE Tasks page SHALL show a project selector at the top offering, in order: Focus (icon), "All" (default selection), then each project by name, sourced from `GET /api/projects`.
2. WHEN a project is selected THEN the list SHALL show only that project's tasks (via the `project_id` fetch) in weight order; "All" clears the filter (no `project_id`).
3. THE selector SHALL include the Unassigned (default) project like any other filter option, labeled by its name, positioned first among the projects by `priorityOrder`.
4. THE project selector SHALL present a **Focus** item as the FIRST pill in the selector row (before "All"), shown with a small focus-themed icon, selectable exactly like a project (single-select).
5. WHEN the Focus pill is selected THEN the Tasks page SHALL show only the top "What's Next?" task (of the full active set) and hide the rest of the list. Focus is mutually exclusive with All / a project selection — it is "All, but only the top task".
6. WHEN a project or All is selected THEN Focus is deselected and the normal (full) list for that scope is shown.
7. THE selector order SHALL be: Focus, All, then each project by `priorityOrder` (Unassigned first among projects).
8. THE selected selector item (Focus / All / project id) SHALL be transient view state that resets on logout (not persisted to the server in this spec; the persistent `focus_mode_enabled` setting + Settings editor is the profile/settings spec).
9. THE project filter/Focus state SHALL not leak across users/sessions inappropriately (reset on logout).

### Requirement 7 — Completion celebration toasts

**User Story:** As a user, I want a little delight when I unlock something, so that finishing tasks feels rewarding.

#### Acceptance Criteria

1. WHEN a completion response includes a non-empty `unlocked` array THEN the app SHALL show a friendly celebration toast for each unlocked achievement, using cute, non-corporate copy.
2. THE celebration copy SHALL be derived from the achievement `type` (mapped to friendly text) with a sensible generic fallback for unknown types.
3. THE celebration toasts SHALL reuse the Toast surface from the app-shell spec and SHALL be dismissible and auto-dismiss.
4. IF the user's `achievement_toasts_enabled` setting is false THEN celebration toasts SHALL be suppressed. (The setting's edit UI is the profile/settings spec; this spec reads the value from the authenticated user.)
5. A completion with an empty `unlocked` array SHALL still succeed silently (no celebration).

## Non-Goals

- Premium weight-breakdown visualization UI (profile/settings spec).
- The Settings page toggles themselves (Focus Mode / toasts editors) — this spec only reads/honors those preferences (profile/settings spec owns the editors).
- Project CRUD / reorder (projects-management spec) — this spec only reads projects for the filter.
- Completed-task history views / analytics (profile/settings spec).
- Swipe-to-defer gestures (nice-to-have; tap→modal is the required path). MAY be added if low-cost, but not required.
- Offline support, push notifications.

## Traceability to product docs

- "What's Next?" prominence, weight hidden for free users: PRD §3.2, §3.5, §4.
- Quick-Add 2-second capture, required subject+priority, optional rest: PRD §3.2, §3.6.
- Action modal + three deferral options: PRD §3.2, §3.6.
- Repeatable tasks + pattern: PRD §3.2.
- Project filter selector ("All" or a project): PRD §3.3.
- Focus Mode shows only top task: PRD §3.6, §5.
- Toast celebrations, friendly copy, toggle-able: PRD §3.4.
- Components (TaskCard, QuickAddModal, ActionModal, DeferralModal, TaskForm, ProjectSelector) and TaskContext/ProjectContext: tech-spec §6.1–6.3.
