# Completion Events (Foundational) Requirements

## Introduction

Several features must react when a task is completed: economy (award currency), streaks, achievements, task-recurrence, and analytics. Task-management currently exposes a single completion hook (`setCompletionHook`) that only one consumer can own. This spec replaces that with a small **completion-event dispatcher** that lets multiple independent listeners subscribe, so each downstream feature can register without overwriting the others.

It also provides the shared schema those downstream features need: `tasks.repeat_series_id` (stable identity for repeatable series, used by streaks + recurrence) and `tasks.weight_at_completion` (recorded when a task is completed, used by economy/analytics/achievements). Recording `weight_at_completion` at completion time is part of this foundational layer.

This is infrastructure only — it awards nothing and unlocks nothing by itself. It aligns with the completion-hook seam already present in `taskService`.

## Glossary

- **Completion Event**: The fact that a task was just completed, described by `{ userId, task, weightAtCompletion }`.
- **Completion Listener**: An async function registered to be invoked for every completion event.
- **Dispatcher**: The registry that holds listeners and invokes them all when a completion occurs.
- **Repeat Series Id**: `tasks.repeat_series_id` — for a repeatable task, a freshly generated UUID (independent of any task id) shared by every occurrence of the same recurring series. Null for non-repeatable tasks.
- **Weight At Completion**: The task's computed weight at the moment it was completed, persisted to `tasks.weight_at_completion`.

## Requirements

### Requirement 1 — Multi-listener dispatch

**User Story:** As a developer, I want multiple features to react to task completion independently, so that each stays decoupled.

#### Acceptance Criteria
1. THE system SHALL provide `registerCompletionListener(fn)` that adds an async listener invoked on every completion event.
2. WHEN a task is completed, THE dispatcher SHALL invoke all registered listeners with the same completion event `{ userId, task, weightAtCompletion, unlocked }`.
3. THE dispatcher SHALL invoke listeners in registration order.
4. THE task-management completion flow SHALL emit the completion event via the dispatcher instead of a single hook.
5. THE dispatcher SHALL support clearing/replacing listeners for test isolation.

### Requirement 2 — Reliability

**User Story:** As a user, I want completing a task to always succeed even if a listener errors.

#### Acceptance Criteria
1. WHEN a listener throws, THE dispatcher SHALL catch and log the error and SHALL continue invoking the remaining listeners.
2. A listener failure SHALL NOT roll back the task completion nor cause the completion endpoint to return 500 for the completion itself.
3. THE dispatcher SHALL run after the task has been persisted as completed.

### Requirement 3 — Unlocked-achievements channel

**User Story:** As a client, I want to know what was unlocked by a completion, so I can show a celebration.

#### Acceptance Criteria
1. THE completion event SHALL carry a mutable `unlocked` array that listeners MAY append to.
2. THE task-management complete response SHALL include the `unlocked` array (empty when nothing unlocked).
3. THE dispatcher SHALL NOT itself populate `unlocked` (that is the achievements feature's job); it only carries the channel.

### Requirement 4 — Shared schema: weight_at_completion

**User Story:** As downstream features, we need the completion weight persisted.

#### Acceptance Criteria
1. THE system SHALL add a nullable `tasks.weight_at_completion integer` column.
2. WHEN a task is completed, THE system SHALL set `weight_at_completion` to the weight computed at completion time.
3. THE value SHALL be the same weight passed to listeners as `weightAtCompletion`.

### Requirement 5 — Shared schema: repeat_series_id

**User Story:** As streaks/recurrence, we need a stable identity for a repeatable series that is independent of any single occurrence row.

#### Acceptance Criteria
1. THE system SHALL add a nullable `tasks.repeat_series_id uuid` column with an index.
2. WHEN a repeatable task is created (not via regeneration), THE system SHALL set `repeat_series_id` to a freshly generated UUID that does not equal any task id.
3. WHEN a task is not repeatable, `repeat_series_id` SHALL remain null.
4. THE series id SHALL be independent of occurrence rows, so deleting or archiving any occurrence does not affect the series identity used by streaks/recurrence.
5. THE column SHALL be available for recurrence to copy onto regenerated occurrences and for streaks to key per-series streaks. (Consuming logic belongs to those specs.)

### Requirement 6 — No behavior change on its own

#### Acceptance Criteria
1. WITH no listeners registered, task completion SHALL behave exactly as before (aside from populating `weight_at_completion` and `repeat_series_id`).
2. THE existing task-management tests SHALL continue to pass after this refactor.
