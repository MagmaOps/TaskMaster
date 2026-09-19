# Streaks Requirements

## Introduction

Streaks reward consistency. A **daily streak** counts consecutive calendar days on which the user completed at least one task. A **per-series streak** counts consecutive completions of a specific repeatable series (identified by `repeat_series_id`). Streaks are updated as a completion listener and exposed via `GET /api/streaks`.

Streaks own the `streaks` table (migration `1000000000001`). It aligns with `docs/prd.md` §3.4 (Streak Tracking) and provides updated streak values that the achievements feature consumes for threshold checks.

## Glossary

- **Daily Streak**: Consecutive days with ≥1 completed task. One row per user with a null series key.
- **Per-Series Streak**: Consecutive completions of a repeatable series, keyed by `repeat_series_id`.
- **current_streak / longest_streak**: Current run length and all-time best.
- **last_completed_date**: The last calendar date the streak advanced.
- **Streak Key**: Either the daily key (null) or a `repeat_series_id`.

## Requirements

### Requirement 1 — Daily streak on completion

**User Story:** As a user, I want a daily streak for completing at least one task per day.

#### Acceptance Criteria
1. WHEN a user completes any task, THE system SHALL update their daily streak row.
2. WHEN `last_completed_date` is today already, THE system SHALL leave `current_streak` unchanged (one advance per day).
3. WHEN `last_completed_date` is yesterday, THE system SHALL increment `current_streak` by 1.
4. WHEN `last_completed_date` is more than one day before today (a gap), OR there is no prior row, THE system SHALL set `current_streak` to 1.
5. THE system SHALL set `longest_streak = max(longest_streak, current_streak)` and `last_completed_date = today`.
6. "Today" and "yesterday" SHALL be computed in a consistent server-local calendar.

### Requirement 2 — Per-series streak for repeatables

**User Story:** As a user, I want each repeatable habit to track its own streak.

#### Acceptance Criteria
1. WHEN a repeatable task (has `repeat_series_id`) is completed, THE system SHALL update a per-series streak keyed by that `repeat_series_id`, using the same increment/reset rules as the daily streak.
2. WHEN a non-repeatable task is completed, THE system SHALL NOT create or update any per-series streak.
3. THE per-series streak SHALL continue across regenerated occurrences (they share the same `repeat_series_id`).

### Requirement 3 — Streaks API

**User Story:** As a user, I want to see my daily streak and my per-habit streaks.

#### Acceptance Criteria
1. WHEN `GET /api/streaks` is called with a valid token, THE system SHALL return the daily streak (`current`, `longest`, `lastCompletedDate`) and a list of per-series streaks.
2. THE per-series list SHALL include, for each series, its current/longest/lastCompletedDate and a human-readable label (the subject of a task in that series).
3. WHEN the user has never completed a task, THE daily streak SHALL be returned as zeros/null and the per-series list empty.
4. WHEN called without a valid token, THE system SHALL return 401; all data SHALL be user-scoped.

### Requirement 4 — Exposed value for achievements

**User Story:** As the achievements feature, I need the updated streak value from a completion.

#### Acceptance Criteria
1. THE streak update SHALL return the resulting `current_streak` for both the daily and per-series updates it performs.
2. THE streak listener SHALL make these values available so achievements can detect threshold crossings for the same completion (via a shared mechanism defined in design).

### Requirement 5 — Reliability and isolation

#### Acceptance Criteria
1. THE streak listener SHALL be registered via `registerAllListeners` at startup.
2. WHEN the streak listener throws, THE completion SHALL still succeed (dispatcher isolation).
3. THE streak updates SHALL be idempotent within a single day (completing multiple tasks in one day advances the daily streak only once).
