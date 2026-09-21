# Requirements Document

## Introduction

Repeatable tasks keep habits alive by regenerating themselves. When a user completes a task that is flagged repeatable, the system creates the **next occurrence** of that task so the habit reappears on its next scheduled day. Recurrence is implemented as a **completion-event listener** (registered on the existing dispatcher) — no new endpoint. On each completion the listener inspects the completed task; if it is repeatable and its schedule has not ended, it inserts a fresh, active copy that shares the same `repeat_series_id` (so streaks and future recurrence stay tied to the series) with a newly-computed `due_date`.

This feature reuses infrastructure that already exists and is tested on disk:

- The `tasks` table incl. `is_repeatable`, `repeat_pattern` (jsonb), `repeat_series_id` (migrations `1000000000001`, `1000000000003`) — **no new migration is required**.
- The `CompletionEvent` contract and dispatcher (`src/services/completion/completionEvents.ts`), and `registerAllListeners` (`src/services/completion/registerListeners.ts`).
- The `RepeatPattern` type (`src/types/task.ts`): `{ frequency: 'daily' | 'weekly'; interval?: number; days_of_week?: number[]; end_date?: string | null }`.
- The user-local calendar-date helpers (`src/services/time/userTime.ts`): `resolveTimezone`, `localCalendarDate`, `nextCalendarDate`.
- The task repository and its project-association helper (`src/repositories/taskRepository.ts`).

Scope is limited to generating the next occurrence of a completed repeatable task. Analytics and the frontend are explicitly **out of scope**.

### Design Decisions Requiring Confirmation

The following are flagged inline in the acceptance criteria and MUST be resolved during design:

- **DD-1 (anchor date for the next due date):** Whether the next `due_date` is computed from the completed occurrence's **own `due_date`** (schedule-anchored — keeps a fixed cadence even if completed early/late) or from the **completion day** (completion-anchored — the streak of "do it every N days from when I last did it"). This document specifies **schedule-anchored when the completed occurrence has a `due_date`, falling back to the user's local completion day when it has none** as the working assumption.
- **DD-2 (weekly with no `days_of_week`):** Whether a `weekly` pattern lacking `days_of_week` advances by `interval` weeks (7 * interval days) from the anchor, or is treated as invalid. This document specifies **advance by `interval` weeks (default interval 1)** as the working assumption.
- **DD-3 (carry-over of due_time):** Whether the generated occurrence keeps the completed task's `due_time`. This document specifies **carry the `due_time` over unchanged** as the working assumption.

## Glossary

- **Recurrence_Service**: The completion-event listener and its supporting service/repository code that generates the next occurrence of a repeatable task.
- **Completion_Event**: The `CompletionEvent` passed to every completion listener. Contains `userId`, `task` (a `Task_With_Meta`), `weightAtCompletion`, `unlocked`, and optional `streaks`.
- **Task_With_Meta**: The completed task record on the event, including `id`, `user_id`, `subject`, `priority`, `due_date`, `due_time`, `is_repeatable`, `repeat_pattern` (a `Repeat_Pattern` or null), `repeat_series_id` (string or null), and `projects` (array of associated projects with ids).
- **Repeat_Pattern**: The jsonb shape `{ frequency: 'daily' | 'weekly'; interval?: number; days_of_week?: number[]; end_date?: string | null }` stored on `tasks.repeat_pattern`.
- **Next_Occurrence**: The new task row inserted by the Recurrence_Service — an active (not completed, not archived) copy of the completed task with the same `repeat_series_id` and a newly-computed `due_date`.
- **Anchor_Date**: The Local_Calendar_Date the next `due_date` is computed from — the completed occurrence's `due_date` when present, otherwise the user's local completion day.
- **User_Local_Day**: The user's Local_Calendar_Date ('YYYY-MM-DD') via `localCalendarDate(resolveTimezone(user.settings.timezone))`.
- **End_Date**: The optional `repeat_pattern.end_date` ('YYYY-MM-DD' or null); the series stops after this date.
- **Days_Of_Week**: An array of integers 0-6 (0 = Sunday) naming the weekdays a weekly series recurs on.
- **Completion_Dispatcher**: The `emitTaskCompleted` mechanism that invokes listeners in registration order and isolates listener errors (a throwing listener is logged, never rethrown).

## Requirements

### Requirement 1: Generate next occurrence on completing a repeatable task

**User Story:** As a user, I want a completed repeatable task to reappear on its next scheduled day, so that my recurring habits keep showing up without re-creating them.

#### Acceptance Criteria

1. WHEN a task is completed AND the completed task's `is_repeatable` is true AND it has a non-null `repeat_pattern`, THE Recurrence_Service SHALL insert exactly one Next_Occurrence for the user.
2. WHEN a task is completed AND the completed task's `is_repeatable` is false, THE Recurrence_Service SHALL NOT insert any Next_Occurrence.
3. IF the completed task's `repeat_pattern` is null, THEN THE Recurrence_Service SHALL NOT insert any Next_Occurrence.
4. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL set its `completed_at` and `archived_at` to null so it is active.

### Requirement 2: Copy the task's defining fields to the next occurrence

**User Story:** As a user, I want the next occurrence to look like the task I set up, so that the recurring habit keeps its subject, priority, projects, and schedule.

#### Acceptance Criteria

1. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL copy the completed task's `subject`, `priority`, `is_repeatable` (true), and `repeat_pattern` unchanged.
2. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL set its `repeat_series_id` to the completed task's `repeat_series_id` (the SAME series, not a fresh one).
3. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL associate it with the same set of projects as the completed task (by project id).
4. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL carry over the completed task's `due_time` unchanged. *(DD-3.)*
5. WHEN a Next_Occurrence is inserted, THE Recurrence_Service SHALL NOT copy the completed task's `weight_at_completion`, `completed_at`, deferral history, or `id`.

### Requirement 3: Compute the next due date (daily)

**User Story:** As a user with a daily-repeating task, I want the next occurrence scheduled the correct number of days ahead.

#### Acceptance Criteria

1. WHEN the `repeat_pattern.frequency` is `daily`, THE Recurrence_Service SHALL compute the next `due_date` as the Anchor_Date advanced by `interval` calendar days, where `interval` defaults to 1 when unset or less than 1.
2. WHEN the completed task has a non-null `due_date`, THE Recurrence_Service SHALL use that `due_date` as the Anchor_Date. *(DD-1: schedule-anchored.)*
3. IF the completed task has a null `due_date`, THEN THE Recurrence_Service SHALL use the User_Local_Day of completion as the Anchor_Date. *(DD-1 fallback.)*
4. THE Recurrence_Service SHALL compute calendar-day advancement in a DST-safe manner (via `nextCalendarDate`-style UTC-noon math), never shifting the date by a timezone offset.

### Requirement 4: Compute the next due date (weekly)

**User Story:** As a user with a weekly-repeating task, I want the next occurrence on the next scheduled weekday.

#### Acceptance Criteria

1. WHEN the `repeat_pattern.frequency` is `weekly` AND `days_of_week` is a non-empty array, THE Recurrence_Service SHALL compute the next `due_date` as the earliest Local_Calendar_Date strictly after the Anchor_Date whose weekday (0-6, Sunday=0) is in `days_of_week`.
2. WHEN the `repeat_pattern.frequency` is `weekly` AND `days_of_week` is empty or unset, THE Recurrence_Service SHALL compute the next `due_date` as the Anchor_Date advanced by `7 * interval` calendar days, where `interval` defaults to 1. *(DD-2.)*
3. WHEN searching for the next matching weekday, THE Recurrence_Service SHALL consider at most 7 days beyond the Anchor_Date (a full week always contains every listed weekday).
4. THE Recurrence_Service SHALL compute weekday and advancement using the same DST-safe calendar-day math as Requirement 3.4.

### Requirement 5: Respect the schedule end date

**User Story:** As a user, I want a recurring series to stop once it passes its end date, so that finished habits do not keep reappearing.

#### Acceptance Criteria

1. WHEN the `repeat_pattern.end_date` is non-null AND the computed next `due_date` is strictly after `end_date`, THE Recurrence_Service SHALL NOT insert a Next_Occurrence.
2. WHEN the `repeat_pattern.end_date` is non-null AND the computed next `due_date` is on or before `end_date`, THE Recurrence_Service SHALL insert the Next_Occurrence.
3. IF the `repeat_pattern.end_date` is null or unset, THEN THE Recurrence_Service SHALL impose no end-date limit and insert the Next_Occurrence.
4. THE Recurrence_Service SHALL compare the next `due_date` and `end_date` as calendar dates ('YYYY-MM-DD' string comparison), not instants.

### Requirement 6: Idempotency and single-occurrence guarantee

**User Story:** As a user, I want exactly one next occurrence per completion, so that completing a repeatable task never spawns duplicates.

#### Acceptance Criteria

1. WHEN a single completion event is dispatched, THE Recurrence_Service SHALL insert at most one Next_Occurrence.
2. WHEN a repeatable task's Next_Occurrence is later completed, THE Recurrence_Service SHALL generate the following occurrence from that newly-completed occurrence (the series continues one occurrence at a time).
3. THE Recurrence_Service SHALL NOT modify, complete, or archive the originally-completed task (it only inserts the new occurrence).

### Requirement 7: Listener registration and reliability

**User Story:** As an operator, I want recurrence to run as a completion listener and never break task completion, so that completions stay reliable.

#### Acceptance Criteria

1. THE Recurrence_Service SHALL register its completion listener via `registerAllListeners`.
2. IF the Recurrence_Service listener throws during a completion, THEN THE Completion_Dispatcher SHALL log the error and complete the task without failing the completion request.
3. WHEN the Recurrence_Service listener runs during normal operation, THE Recurrence_Service SHALL complete without throwing.
4. THE Recurrence_Service listener SHALL NOT depend on any ordering relative to the economy, streaks, or achievements listeners (it reads only `event.task` and the user's timezone).

### Requirement 8: Timezone correctness

**User Story:** As a user in any timezone, I want "today" for scheduling computed in my zone, so that the next occurrence lands on the right calendar day.

#### Acceptance Criteria

1. WHEN the Anchor_Date falls back to the completion day (null `due_date`), THE Recurrence_Service SHALL use `localCalendarDate(resolveTimezone(user.settings.timezone))` for that day.
2. IF the user record or its timezone is missing or invalid, THEN THE Recurrence_Service SHALL resolve the timezone to UTC and proceed without throwing.
3. THE Recurrence_Service SHALL treat all `due_date`, Anchor_Date, End_Date, and computed dates as calendar dates ('YYYY-MM-DD'), using only calendar-day math for scheduling.

