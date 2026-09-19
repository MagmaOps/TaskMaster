# Task Management Requirements

## Introduction

Task Management is the core of TaskMaster: creating, listing, editing, completing, deferring, and archiving tasks, plus the **weight algorithm** that automatically orders tasks so the user always sees "What's Next?". Weight is computed server-side on every fetch from task age, priority, due date/time, project priority, deferral count, and repeatable status. Users never reorder manually.

This spec folds in and supersedes the former `task-weight-calculation` spec, corrected to the **3-level priority** model (`high`/`medium`/`low`) that matches the database schema. It builds on the auth-system (every task belongs to a `user_id`) and aligns with `docs/technical-specification.md` §4 (algorithm) and §5.4 (API).

## Glossary

- **Task**: A row in `tasks` owned by a user; active, completed, or archived.
- **Weight**: A computed integer (higher = more urgent) used to order tasks. Never stored; recomputed per fetch.
- **Active Task**: `completed_at IS NULL AND archived_at IS NULL`.
- **Deferral**: A "Later" action recorded in `deferrals`, contributing to weight.
- **Repeatable Task**: A task flagged `is_repeatable` with a `repeat_pattern`; gets a due-date weight boost. (Recurrence regeneration and streaks are handled by the gamification spec.)
- **Weight Breakdown**: A per-factor explanation of a task's weight, returned only to premium users who enabled weight visibility.
- **Priority Multiplier**: `high=3`, `medium=2`, `low=1`.

## Requirements

### Requirement 1 — Create tasks

**User Story:** As a user, I want to quickly capture a task with minimal fields, so that I can offload it immediately.

#### Acceptance Criteria
1. WHEN a user POSTs a task with a non-empty `subject` and valid `priority`, THE system SHALL create an active task owned by the authenticated user and return it with its computed weight.
2. THE system SHALL require `subject` (1–500 chars) and `priority` (`high`|`medium`|`low`); all other fields are optional.
3. THE system SHALL accept optional `due_date` (YYYY-MM-DD), `due_time` (HH:MM), `project_ids` (array of the user's project UUIDs), `is_repeatable` (bool), and `repeat_pattern` (object, required when `is_repeatable` is true).
4. WHEN `project_ids` includes a project not owned by the user, THE system SHALL reject the request with 400.
5. WHEN creation succeeds, THE system SHALL associate the task with the given projects via `task_projects`.
6. THE system SHALL set `created_at` to now (used for age) and leave `completed_at`/`archived_at` null.

### Requirement 2 — List tasks ("What's Next?")

**User Story:** As a user, I want my active tasks returned already ordered by importance, so that the top item is what I should do next.

#### Acceptance Criteria
1. WHEN a user GETs their tasks, THE system SHALL return active tasks for that user only, sorted by computed weight descending.
2. THE system SHALL include for each task: id, subject, priority, due_date, due_time, is_repeatable, created_at, completed_at, projects[], deferral_count, and weight.
3. WHEN the query param `project_id` is provided, THE system SHALL return only tasks associated with that project (still weight-sorted).
4. WHEN `include_completed=true` is provided, THE system SHALL also include completed (non-archived) tasks.
5. THE system SHALL never return another user's tasks.
6. WHEN the requesting user is premium AND has `weight_visibility_enabled`, THE system SHALL include a `weight_breakdown` object per task; otherwise it SHALL omit it.

### Requirement 3 — Weight algorithm

**User Story:** As a user, I want a consistent, predictable ordering so I can trust the system.

#### Acceptance Criteria
1. THE system SHALL compute base weight as `(ageInDays + 1) × priorityMultiplier`, where `ageInDays` is whole days since `created_at` and the `+1` guarantees non-zero on the creation day.
2. THE system SHALL derive the due moment from `due_date` combined with `due_time`; WHEN a task has a `due_date` but no `due_time`, THE system SHALL treat the due moment as the end of the due date (23:59:59 local). THE system SHALL compute `hoursUntilDue` as the exact (fractional) hours from now to that due moment.
3. WHEN a task is overdue (`hoursUntilDue < 0`), THE system SHALL add `daysOverdue × 10`, where `daysOverdue = ceil(|hoursUntilDue| ÷ 24)`.
4. WHEN a task is due within the next 7 days (`0 ≤ hoursUntilDue ≤ 168`), THE system SHALL add a continuous, time-aware bonus of `(7 − hoursUntilDue ÷ 24) × (35 ÷ 7)`, so that between two tasks due on the same calendar day the one with the earlier `due_time` receives more weight; due more than 7 days away adds nothing.
5. WHEN a task is assigned to projects AND the user has project priority enabled, THE system SHALL multiply the weight by `(1 + projectMultiplier)` using the highest-priority (lowest `priority_order`) project the task belongs to.
6. THE system SHALL compute `projectMultiplier` as `1.0` for a single project, otherwise `clamp(1.0 − (priority_order − 1) ÷ (totalProjects − 1), 0, 1)`.
7. THE system SHALL add `deferralCount × 5` after other adjustments.
8. WHEN a repeatable task is due today, THE system SHALL multiply the final weight by 2.
9. THE system SHALL return weight as a rounded integer and SHALL produce identical output for identical inputs.
10. WHEN a task has no due date, THE system SHALL apply only age, priority, project, and deferral factors.

### Requirement 4 — Update tasks

**User Story:** As a user, I want to edit a task's details, so that I can correct or refine it.

#### Acceptance Criteria
1. WHEN a user PUTs changes to their own task, THE system SHALL update the provided fields (subject, priority, due_date, due_time, project_ids, is_repeatable, repeat_pattern) and return the updated task with recomputed weight.
2. THE system SHALL treat all fields as optional on update; omitted fields remain unchanged.
3. WHEN `project_ids` is provided, THE system SHALL replace the task's project associations with the given set (validating ownership).
4. WHEN the task does not exist or belongs to another user, THE system SHALL return 404.
5. THE system SHALL update `updated_at` on any change.

### Requirement 5 — Complete tasks

**User Story:** As a user, I want to mark a task done, so that it leaves my active list and I get credit.

#### Acceptance Criteria
1. WHEN a user completes their own active task, THE system SHALL set `completed_at` to now and return the task with the weight it had at completion.
2. WHEN completing an already-completed task, THE system SHALL return 409.
3. WHEN the task does not exist or belongs to another user, THE system SHALL return 404.
4. THE system SHALL expose a documented hook point so gamification (achievements, streaks, currency) can run on completion, without task-management itself implementing gamification.

### Requirement 6 — Defer tasks ("Accountable Procrastination")

**User Story:** As a user, I want guilt-free "Later" options, so postponing is easy and tracked.

#### Acceptance Criteria
1. THE system SHALL accept a defer action with `option` in (`later_today`, `tomorrow`, `sometime_later`) on the user's own active task.
2. WHEN `later_today`, THE system SHALL set `due_date` to today (preserving time if set) and record a deferral.
3. WHEN `tomorrow`, THE system SHALL set `due_date` to tomorrow and record a deferral.
4. WHEN `sometime_later`, THE system SHALL lower priority one level (high→medium→low; low stays low), clear `due_date` and `due_time`, and record a deferral.
5. THE system SHALL insert a row in `deferrals` with the chosen option for every defer action (increasing future weight via deferral count).
6. WHEN the task does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 7 — Archive / delete tasks

**User Story:** As a user, I want to remove a task from my list without losing history.

#### Acceptance Criteria
1. WHEN a user deletes their own task, THE system SHALL soft-delete it by setting `archived_at` to now and return 204.
2. THE system SHALL exclude archived tasks from active and completed listings.
3. WHEN the task does not exist or belongs to another user, THE system SHALL return 404.

### Requirement 8 — Ownership, validation, and errors

**User Story:** As a user, I want my data isolated and errors clear.

#### Acceptance Criteria
1. THE system SHALL require a valid access token on all task endpoints and scope every operation to the authenticated user.
2. THE system SHALL validate inputs (subject length, priority enum, date/time formats, project id format) and return 400 `VALIDATION_ERROR` with details on failure.
3. THE system SHALL return the standard success/error envelopes used across the API.
4. THE system SHALL use parameterized queries for all database access.
