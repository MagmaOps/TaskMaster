# Requirements Document

## Introduction

The Achievements feature unlocks milestone rewards when a user completes a task. It is implemented as a **completion-event listener** (registered on the existing completion dispatcher) plus a single read endpoint. On each task completion the listener inspects the completion event — the completed task, its weight, and the just-updated streak values published by the streak listener — and unlocks any newly-earned milestone achievements. Each newly-unlocked achievement is appended to `event.unlocked` so the task-completion HTTP response can celebrate it, and is persisted in the existing `achievements` table idempotently (unlocking the same achievement twice never creates a duplicate).

This feature reuses infrastructure that already exists and is tested on disk:

- The `achievements` table (migration `1000000000001`) — **no new migration is required**.
- The `CompletionEvent` contract, dispatcher, and `event.unlocked` / `event.streaks` channels (`src/services/completion/completionEvents.ts`).
- The streak listener that populates `event.streaks` (`src/services/streaks/streakService.ts`), registered before achievements in `registerAllListeners`.
- The user-local calendar-date helpers (`src/services/time/userTime.ts`).

Scope is limited to achievements only. Task recurrence and analytics are explicitly **out of scope**.

### Design Decisions Requiring Confirmation

The following are flagged inline in the acceptance criteria and MUST be resolved during design:

- **DD-1 (productivity_burst recurrence):** Whether `productivity_burst_10` unlocks once per user-local day (recurring daily, keyed by date) or once ever. This document specifies **once per user-local day** as the working assumption.
- **DD-2 (high_weight scope):** Whether `high_weight_completed` unlocks once per qualifying task or once ever. This document specifies **once per qualifying task** as the working assumption.
- **DD-3 (threshold-crossing vs equality):** Whether streak milestones fire on strict equality (`daily === N`) or on threshold crossing (`daily >= N` combined with idempotency). This document specifies **`>= N` with `ON CONFLICT DO NOTHING`** as the working assumption, since idempotency prevents re-firing.

## Glossary

- **Achievements_Service**: The completion-event listener and its supporting service/repository code that unlocks and reads achievements.
- **Completion_Event**: The `CompletionEvent` object passed to every completion listener. Contains `userId`, `task` (a `Task_With_Meta`), `weightAtCompletion` (number), `unlocked` (an `Unlocked_Achievement[]` array to append to), and an optional `streaks` object `{ daily: number; series?: number }`.
- **Task_With_Meta**: The completed task record on the event, including `id`, `user_id`, `subject`, `priority`, `is_repeatable`, `repeat_series_id` (string or null), `deferral_count` (number), and `completed_at`.
- **Unlocked_Achievement**: The shape `{ type: string; data?: Record<string, unknown> }` appended to `event.unlocked`.
- **Achievement_Type**: The string identifier of a milestone (e.g. `first_task_completed`, `daily_streak_7`).
- **Achievements_Table**: The existing `achievements` table with columns `id`, `user_id`, `type`, `unlocked_at`, `data` (jsonb), and a unique index `idx_achievements_unique` on `(user_id, type, COALESCE(data->>'task_id', ''))`.
- **Unique_Slot**: The `data->>'task_id'` value used by `idx_achievements_unique` to allow one achievement of a given type per distinct slot value (used to store a series id, a task id, or a local date).
- **Daily_Streak**: The user's consecutive-day completion run length, read from `event.streaks.daily`.
- **Series_Streak**: A per-repeatable-series consecutive-day run length, read from `event.streaks.series`, associated with the completed task's `repeat_series_id`.
- **User_Local_Day**: The user's Local_Calendar_Date ('YYYY-MM-DD') computed via `localCalendarDate(resolveTimezone(user.settings.timezone))`, matching the approach used by streaks.
- **Weight_Threshold**: The configurable minimum `weightAtCompletion` for `high_weight_completed`, default `200`.
- **Completion_Dispatcher**: The `emitTaskCompleted` mechanism that invokes listeners in registration order and isolates listener errors (a throwing listener is logged, never rethrown).

## Requirements

### Requirement 1: First-completion milestone

**User Story:** As a user, I want a welcome achievement the first time I complete any task, so that I feel rewarded for getting started.

#### Acceptance Criteria

1. WHEN a task is completed AND the user has no prior `first_task_completed` achievement, THE Achievements_Service SHALL unlock an achievement of type `first_task_completed` for the user.
2. WHEN a task is completed AND the user already has a `first_task_completed` achievement, THE Achievements_Service SHALL NOT unlock a second `first_task_completed` achievement.
3. WHEN a `first_task_completed` achievement is newly unlocked, THE Achievements_Service SHALL append an Unlocked_Achievement with type `first_task_completed` to `event.unlocked`.

### Requirement 2: Daily-streak milestones

**User Story:** As a user, I want milestone achievements as my daily streak reaches 7, 14, 30, and 90 days, so that consistent daily habits are recognized.

#### Acceptance Criteria

1. WHEN a task is completed AND `event.streaks.daily` is present AND `event.streaks.daily` is greater than or equal to 7 AND no `daily_streak_7` achievement exists for the user, THE Achievements_Service SHALL unlock an achievement of type `daily_streak_7` for the user. *(DD-3: `>= N` with idempotent insert.)*
2. WHEN a task is completed AND `event.streaks.daily` is greater than or equal to 14 AND no `daily_streak_14` achievement exists for the user, THE Achievements_Service SHALL unlock an achievement of type `daily_streak_14` for the user.
3. WHEN a task is completed AND `event.streaks.daily` is greater than or equal to 30 AND no `daily_streak_30` achievement exists for the user, THE Achievements_Service SHALL unlock an achievement of type `daily_streak_30` for the user.
4. WHEN a task is completed AND `event.streaks.daily` is greater than or equal to 90 AND no `daily_streak_90` achievement exists for the user, THE Achievements_Service SHALL unlock an achievement of type `daily_streak_90` for the user.
5. IF `event.streaks` is undefined OR `event.streaks.daily` is undefined, THEN THE Achievements_Service SHALL evaluate no daily-streak milestones for the completion.
6. WHEN a daily-streak achievement is newly unlocked, THE Achievements_Service SHALL append the corresponding Unlocked_Achievement to `event.unlocked`.

### Requirement 3: Repeatable-series-streak milestones

**User Story:** As a user, I want per-series milestone achievements as a repeatable task's streak reaches 7, 30, and 100 days, so that each recurring habit is recognized on its own.

#### Acceptance Criteria

1. WHEN a task is completed AND the task has a non-null `repeat_series_id` AND `event.streaks.series` is greater than or equal to 7 AND no `repeatable_streak_7` achievement exists for the user with a Unique_Slot equal to the task's `repeat_series_id`, THE Achievements_Service SHALL unlock a `repeatable_streak_7` achievement storing the `repeat_series_id` in the Unique_Slot.
2. WHEN a task is completed AND the task has a non-null `repeat_series_id` AND `event.streaks.series` is greater than or equal to 30 AND no `repeatable_streak_30` achievement exists for the user with a Unique_Slot equal to the task's `repeat_series_id`, THE Achievements_Service SHALL unlock a `repeatable_streak_30` achievement storing the `repeat_series_id` in the Unique_Slot.
3. WHEN a task is completed AND the task has a non-null `repeat_series_id` AND `event.streaks.series` is greater than or equal to 100 AND no `repeatable_streak_100` achievement exists for the user with a Unique_Slot equal to the task's `repeat_series_id`, THE Achievements_Service SHALL unlock a `repeatable_streak_100` achievement storing the `repeat_series_id` in the Unique_Slot.
4. WHERE two repeatable tasks belong to different series, THE Achievements_Service SHALL allow the same repeatable-streak Achievement_Type to unlock once for each distinct `repeat_series_id`.
5. IF `event.streaks.series` is undefined OR the completed task has a null `repeat_series_id`, THEN THE Achievements_Service SHALL evaluate no repeatable-series milestones for the completion.
6. WHEN a repeatable-streak achievement is newly unlocked, THE Achievements_Service SHALL append the corresponding Unlocked_Achievement to `event.unlocked`.

### Requirement 4: Productivity-burst milestone

**User Story:** As a user, I want a productivity-burst achievement when I complete many tasks in one day, so that a highly productive day is celebrated.

#### Acceptance Criteria

1. WHEN a task is completed, THE Achievements_Service SHALL count the user's completed tasks whose completion falls within the current User_Local_Day.
2. WHEN a task is completed AND the User_Local_Day completion count is greater than or equal to 10 AND no `productivity_burst_10` achievement exists for the user with a Unique_Slot equal to the current User_Local_Day, THE Achievements_Service SHALL unlock a `productivity_burst_10` achievement storing the current User_Local_Day in the Unique_Slot. *(DD-1: once per User_Local_Day.)*
3. WHERE two qualifying completions occur on different User_Local_Days, THE Achievements_Service SHALL allow `productivity_burst_10` to unlock once for each distinct User_Local_Day.
4. WHEN the User_Local_Day completion count is computed, THE Achievements_Service SHALL determine the day using `localCalendarDate(resolveTimezone(user.settings.timezone))`.
5. WHEN a `productivity_burst_10` achievement is newly unlocked, THE Achievements_Service SHALL append the corresponding Unlocked_Achievement to `event.unlocked`.

### Requirement 5: Accountable-procrastination milestone

**User Story:** As a user, I want a reward for finally completing a heavily-deferred task, so that facing avoided work is recognized.

#### Acceptance Criteria

1. WHEN a task is completed AND the task's `deferral_count` is greater than or equal to 3 AND no `accountable_procrastination` achievement exists for the user with a Unique_Slot equal to the task's `id`, THE Achievements_Service SHALL unlock an `accountable_procrastination` achievement storing the task's `id` in the Unique_Slot.
2. WHERE two heavily-deferred tasks are completed, THE Achievements_Service SHALL allow `accountable_procrastination` to unlock once for each distinct task `id`.
3. WHEN an `accountable_procrastination` achievement is newly unlocked, THE Achievements_Service SHALL append the corresponding Unlocked_Achievement to `event.unlocked`.

### Requirement 6: High-weight-completion milestone

**User Story:** As a user, I want an achievement for completing a big or long-neglected task, so that tackling high-weight work is rewarded.

#### Acceptance Criteria

1. THE Achievements_Service SHALL read the Weight_Threshold from configuration, defaulting to 200 when unconfigured.
2. WHEN a task is completed AND `event.weightAtCompletion` is greater than or equal to the Weight_Threshold AND no `high_weight_completed` achievement exists for the user with a Unique_Slot equal to the task's `id`, THE Achievements_Service SHALL unlock a `high_weight_completed` achievement storing the task's `id` in the Unique_Slot. *(DD-2: once per qualifying task.)*
3. WHERE two tasks meeting the Weight_Threshold are completed, THE Achievements_Service SHALL allow `high_weight_completed` to unlock once for each distinct task `id`.
4. WHEN a `high_weight_completed` achievement is newly unlocked, THE Achievements_Service SHALL append the corresponding Unlocked_Achievement to `event.unlocked`.

### Requirement 7: Idempotent unlocking

**User Story:** As a user, I want each earned achievement recorded once, so that my achievement list never shows duplicates.

#### Acceptance Criteria

1. WHEN the Achievements_Service unlocks an achievement, THE Achievements_Service SHALL insert into the Achievements_Table using `INSERT ... ON CONFLICT DO NOTHING RETURNING` so that a conflicting row is not duplicated.
2. WHEN an insert conflicts with an existing row on `idx_achievements_unique`, THE Achievements_Service SHALL treat the achievement as not newly unlocked and SHALL NOT append it to `event.unlocked`.
3. WHEN an insert creates a new row, THE Achievements_Service SHALL treat the achievement as newly unlocked and SHALL append it to `event.unlocked`.
4. WHEN the same task completion is evaluated more than once, THE Achievements_Service SHALL append each achievement to `event.unlocked` at most once per newly-created row.

### Requirement 8: Completion response reflects newly-unlocked achievements

**User Story:** As a client application, I want the task-completion response to include the achievements just unlocked, so that I can display celebration toasts.

#### Acceptance Criteria

1. WHEN a task completion produces one or more newly-unlocked achievements, THE Achievements_Service SHALL append each as an Unlocked_Achievement to `event.unlocked` before the Completion_Dispatcher returns.
2. WHEN a task completion produces no newly-unlocked achievements, THE Achievements_Service SHALL leave `event.unlocked` unchanged.
3. WHERE an Unlocked_Achievement is keyed to a specific slot value, THE Achievements_Service SHALL include the slot value (series id, task id, or User_Local_Day) in the Unlocked_Achievement `data`.

### Requirement 9: Read unlocked achievements

**User Story:** As a user, I want to retrieve my unlocked achievements, so that I can view my progress on my profile.

#### Acceptance Criteria

1. WHEN an authenticated GET request is made to `/api/achievements`, THE Achievements_Service SHALL return the list of achievements belonging to the requesting user.
2. IF a GET request to `/api/achievements` has no valid authentication token, THEN THE Achievements_Service SHALL respond with HTTP status 401.
3. THE Achievements_Service SHALL scope the returned achievements to the authenticated user's `user_id` and SHALL exclude achievements belonging to other users.
4. WHEN achievements are returned, THE Achievements_Service SHALL respond with HTTP status 200 and a body of the form `{ success: true, data: <achievements> }`.
5. WHEN the authenticated user has no achievements, THE Achievements_Service SHALL respond with HTTP status 200 and an empty list.

### Requirement 10: Listener registration and reliability

**User Story:** As an operator, I want the achievements listener to run after streaks and never break task completion, so that completions stay reliable.

#### Acceptance Criteria

1. THE Achievements_Service SHALL register its completion listener via `registerAllListeners` after the streak listener.
2. IF the Achievements_Service listener throws during a completion, THEN THE Completion_Dispatcher SHALL log the error and complete the task without failing the completion request.
3. WHEN the Achievements_Service listener runs during normal operation, THE Achievements_Service SHALL complete without throwing.
4. IF `event.streaks` is undefined, THEN THE Achievements_Service SHALL evaluate the non-streak milestones (first-completion, productivity-burst, accountable-procrastination, high-weight) and SHALL skip the streak-based milestones.
