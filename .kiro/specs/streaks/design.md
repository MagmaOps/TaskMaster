# Streaks Design

## Overview

Streaks is a completion listener that maintains a daily streak and per-series streaks, plus a read endpoint. The core update logic is a small pure function (given last date + today → new current/longest) so it's exhaustively unit-testable; the repository handles the upsert.

## Schema decision — the streak key column

The existing `streaks` table has:
`streaks(id, user_id, task_id uuid REFERENCES tasks(id) ON DELETE CASCADE, current_streak, longest_streak, last_completed_date, updated_at)` with a unique index on `(user_id, COALESCE(task_id, '000...'))`.

Per-series streaks must key on `repeat_series_id`, which is a **standalone UUID, not a task id** — so it cannot go in `task_id` (FK to tasks, and would break if that occurrence is deleted). We need a dedicated key column.

**Migration `1000000000004_streaks_series_key`:**
- Add `streaks.series_id uuid` (nullable, no FK — series ids are standalone).
- Drop the old unique index keyed on `task_id`; add a unique index on `(user_id, COALESCE(series_id, '00000000-0000-0000-0000-000000000000'::uuid))`.
- `task_id` becomes unused for streaks going forward; leave the column (harmless) or drop it. **Decision:** drop `task_id` from `streaks` to avoid a confusing dead column (greenfield, no data to preserve). Update the unique index accordingly.
- Daily streak = row with `series_id IS NULL`. Per-series = `series_id = <repeat_series_id>`.

Reversible down restores `task_id` + old index.

## Pure streak math (`src/services/streaks/streakMath.ts`)

```ts
interface StreakState { current: number; longest: number; lastCompletedDate: string | null; }
function advanceStreak(prev: StreakState | null, today: string): StreakState
```
Rules (dates are 'YYYY-MM-DD', compared as calendar days):
- `prev == null` → `{ current: 1, longest: 1, lastCompletedDate: today }`.
- `prev.lastCompletedDate == today` → unchanged (idempotent same-day).
- `prev.lastCompletedDate == today - 1 day` → `current+1`, `longest = max(longest, current+1)`.
- otherwise (gap) → `current = 1`, `longest = max(longest, 1)`.
Injectable/explicit `today` for deterministic tests.

## streakRepository (`src/repositories/streakRepository.ts`)
- `getByKey(userId, seriesId | null): StreakRow | null`
- `upsert(userId, seriesId | null, state): void` — INSERT ... ON CONFLICT (unique key) DO UPDATE.
- `listForUser(userId): { daily, series: [...] }` — daily row + per-series rows joined to a representative subject. Subject label: for each `series_id`, pick a subject from a task with that `repeat_series_id` (e.g. most recent occurrence). `LEFT JOIN LATERAL` or a grouped subquery.

Note: since a series can have many occurrence rows, the "label" query selects one subject per series_id (max(created_at)).

## streakService (`src/services/streaks/streakService.ts`)
- `applyForCompletion(userId, seriesId | null, today): number` — load prev, compute `advanceStreak`, upsert, return new `current`.
- `onTaskCompleted(event)` — the listener:
  1. `dailyCurrent = applyForCompletion(userId, null, today)`.
  2. if `event.task.repeat_series_id`: `seriesCurrent = applyForCompletion(userId, seriesId, today)`.
  3. stash results on the event for achievements (see below).
- `getStreaks(userId)` — for the API.

## Sharing streak results with achievements (Requirement 4)

Achievements (built next) needs the just-updated streak values for the same completion to detect thresholds (e.g. daily streak hit 7). Rather than re-querying, streaks attaches its results to the event via an extensible, typed side-channel:

- Extend `CompletionEvent` (in completion-events) with an optional `streaks?: { daily: number; series?: number }` field that the streak listener sets and later listeners may read.
- **Listener ordering matters:** `registerAllListeners` MUST register the streak listener **before** the achievements listener so achievements sees populated values. This ordering is documented in `registerListeners.ts`.

(Adding the optional field to `CompletionEvent` is a tiny change to the foundational type; it stays generic — just a place to publish computed streak values.)

## Controller + routes
- `GET /api/streaks` behind authMiddleware → `{ success, data: { daily, series } }`.
- Mount `/api/streaks` in app.ts; register streak listener in `registerAllListeners` (before achievements).

## API DTO
```
{
  daily: { current, longest, lastCompletedDate } | { current: 0, longest: 0, lastCompletedDate: null },
  series: [ { seriesId, label, current, longest, lastCompletedDate } ]
}
```

## Testing Strategy
- **Unit (pure):** `advanceStreak` — first ever; same-day no-op; yesterday increments + longest; gap resets; longest preserved on reset.
- **Integration (Supertest + test DB):**
  - complete a task today → daily streak current 1.
  - simulate yesterday by setting `last_completed_date = today-1` directly, complete again → current 2.
  - simulate a 3-day gap → reset to 1, longest retained.
  - two completions same day → daily current stays 1.
  - repeatable completion advances a per-series streak; a second repeatable series is independent; non-repeatable does not create a series row.
  - `GET /api/streaks` shape incl. per-series label; empty for a fresh user; 401 without token; user-scoped.
  - streak suite resets listeners to the streak listener (determinism), per the established pattern.
