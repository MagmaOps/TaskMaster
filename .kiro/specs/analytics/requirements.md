# Requirements Document

## Introduction

Project analytics let a user see where their completed effort went. A single authenticated read endpoint, `GET /api/analytics/projects`, returns one row per project the user owns, each summarizing the completed tasks associated with that project: how many were completed, the total weight completed, and when the most recent completion happened. This supports the PRD reflection goal ("Am I working on what I say I prioritize?", docs/prd.md 3.5).

This feature is a **read-only aggregation** with no writes and no completion listener. It reuses infrastructure that already exists and is tested on disk:

- The `tasks` table incl. `completed_at`, `archived_at`, and `weight_at_completion` (migrations `1000000000001`, `1000000000003`) — **no new migration is required**.
- The `projects` and `task_projects` tables and their ownership scoping (`user_id`).
- The authenticated read pattern (authMiddleware + `{ success, data }` envelope) used by `GET /api/economy` and `GET /api/streaks`.
- The user-local calendar-date helper `localCalendarDate(resolveTimezone(user.settings.timezone))` (`src/services/time/userTime.ts`).

Scope is limited to per-project completion analytics. The frontend and any non-project analytics (daily/weekly progress reports, per-project completion streaks) are explicitly **out of scope** for this spec.

### Design Decisions Requiring Confirmation

The following are flagged inline in the acceptance criteria and MUST be resolved during design:

- **DD-1 (projects with no completions):** Whether a project the user owns but has never completed a task in appears with zero stats, or is omitted. This document specifies **include it with `tasks_completed = 0`, `weight_completed = 0`, `last_completion_date = null`** as the working assumption (so the UI can show every project).
- **DD-2 (multi-project tasks):** A completed task associated with N projects contributes to each of those N projects. This document specifies **count the completion toward every project it is associated with** (matching the `task_projects` join) as the working assumption; the totals across projects may therefore exceed the number of distinct completed tasks.
- **DD-3 (unassigned completions):** Resolved by the projects-management Unassigned-project revision: every task belongs to exactly one project (a Real_Project or its owner Unassigned project), so there are no project-less completed tasks. The endpoint is strictly per-project and the previously-unassigned effort surfaces as the **Unassigned** project row (no separate synthetic bucket needed).
- **DD-4 (`last_completion_date` form):** Whether the date is the user-local calendar date or a raw timestamp. This document specifies **the user-local calendar date ('YYYY-MM-DD') computed in the user timezone**, consistent with streaks and achievements.
- **DD-5 (null `weight_at_completion`):** Legacy/edge completions may have a null `weight_at_completion`. This document specifies **treat null as 0 in the weight sum** (count the task, contribute 0 weight).

## Glossary

- **Analytics_Service**: The service/repository code and single controller/route that computes and returns per-project completion analytics.
- **Project_Analytics_Row**: One entry in the response — `{ projectId, name, priorityOrder, color, tasksCompleted, weightCompleted, lastCompletionDate }`.
- **Completed_Task**: A task with a non-null `completed_at` and a null `archived_at`, owned by the requesting user.
- **Weight_Completed**: The SUM of `weight_at_completion` over a project's Completed_Tasks, treating null as 0.
- **Tasks_Completed**: The COUNT of a project's Completed_Tasks.
- **Last_Completion_Date**: The most recent completion's user-local calendar date ('YYYY-MM-DD') among a project's Completed_Tasks, or null when there are none.
- **User_Local_Date**: A 'YYYY-MM-DD' calendar date in the user timezone via `localCalendarDate(resolveTimezone(user.settings.timezone))`; for a stored instant, the calendar day of that instant in the user zone.
- **Owned_Project**: A project row whose `user_id` equals the requesting user's id.

## Requirements

### Requirement 1: Per-project completion counts and weight

**User Story:** As a user, I want to see how many tasks I completed and how much weight I cleared per project, so that I can tell where my effort actually went.

#### Acceptance Criteria

1. WHEN an authenticated GET request is made to `/api/analytics/projects`, THE Analytics_Service SHALL return one Project_Analytics_Row for each Owned_Project.
2. WHEN computing a Project_Analytics_Row, THE Analytics_Service SHALL set `tasksCompleted` to the COUNT of that project's Completed_Tasks.
3. WHEN computing a Project_Analytics_Row, THE Analytics_Service SHALL set `weightCompleted` to the SUM of `weight_at_completion` over that project's Completed_Tasks, treating a null `weight_at_completion` as 0. *(DD-5.)*
4. WHERE a completed task is associated with more than one project, THE Analytics_Service SHALL count that completion toward each associated project. *(DD-2.)*
5. THE Analytics_Service SHALL only include tasks whose `completed_at` is non-null AND `archived_at` is null.

### Requirement 2: Last completion date per project

**User Story:** As a user, I want to see when I last completed something in each project, so that I can spot projects I have been neglecting.

#### Acceptance Criteria

1. WHEN computing a Project_Analytics_Row, THE Analytics_Service SHALL set `lastCompletionDate` to the User_Local_Date of the most recent Completed_Task associated with that project.
2. IF a project has no Completed_Tasks, THEN THE Analytics_Service SHALL set `lastCompletionDate` to null.
3. WHEN deriving the User_Local_Date, THE Analytics_Service SHALL compute the calendar day of the completion instant in the user timezone via `localCalendarDate(resolveTimezone(user.settings.timezone))`. *(DD-4.)*
4. WHEN the most recent completion is selected, THE Analytics_Service SHALL select it by the true completion instant (`completed_at`), not by the truncated calendar date.

### Requirement 3: Include projects with no completions

**User Story:** As a user, I want every project listed even if I have not completed anything in it yet, so that the analytics view matches my project list.

#### Acceptance Criteria

1. WHERE an Owned_Project has zero Completed_Tasks, THE Analytics_Service SHALL still return a Project_Analytics_Row for it with `tasksCompleted = 0`, `weightCompleted = 0`, and `lastCompletionDate = null`. *(DD-1.)*
2. THE Analytics_Service SHALL represent every completed task via its project membership; because the Unassigned project owns any task with no Real_Project, no completed task is omitted and no separate synthetic bucket is created. *(DD-3.)*
3. WHEN a Project_Analytics_Row is returned, THE Analytics_Service SHALL include the project's `projectId`, `name`, `priorityOrder`, and `color`.

### Requirement 4: Ordering

**User Story:** As a user, I want the analytics rows in a stable, meaningful order, so that the view is predictable.

#### Acceptance Criteria

1. THE Analytics_Service SHALL order Project_Analytics_Rows by the project's `priority_order` ascending (matching `GET /api/projects`).

### Requirement 5: Authentication and user scoping

**User Story:** As a user, I want only my own analytics, so that no other user's data is ever exposed.

#### Acceptance Criteria

1. IF a GET request to `/api/analytics/projects` has no valid authentication token, THEN THE Analytics_Service SHALL respond with HTTP status 401.
2. THE Analytics_Service SHALL scope every Owned_Project and every Completed_Task to the authenticated user's `user_id` and SHALL exclude any other user's projects and tasks.
3. WHEN analytics are returned, THE Analytics_Service SHALL respond with HTTP status 200 and a body of the form `{ success: true, data: <rows> }`.
4. WHEN the authenticated user has no Real_Projects, THE Analytics_Service SHALL respond with HTTP status 200 and a list containing exactly the user's Unassigned_Project row (zeroed). *(After the projects-management Unassigned revision every user always has an Unassigned project, so the list is never empty; a user with no completions anywhere still gets that single zeroed row.)*

### Requirement 6: Read-only and efficient

**User Story:** As an operator, I want the analytics endpoint to be a cheap read that never mutates data, so that it is safe to call often.

#### Acceptance Criteria

1. THE Analytics_Service SHALL NOT insert, update, delete, or archive any row when serving the endpoint.
2. THE Analytics_Service SHALL compute all per-project aggregates in a single database query (no per-project round trips, no N+1).
3. THE Analytics_Service SHALL use parameterized SQL scoped by `user_id`.

