# Streaks Implementation Tasks

Completion listener maintaining daily + per-series streaks. Owns the `streaks` table. Tasks marked `*` optional.

- [x] 1. Migration `1000000000004_streaks_series_key`
  - Add `streaks.series_id uuid` (nullable, no FK — standalone series id)
  - Drop `streaks.task_id` and its old unique index; add unique index on `(user_id, COALESCE(series_id, zero-uuid))`
  - reversible down; apply to dev
  - _Requirements: 2.1, 2.3_

- [x] 2. Pure streak math + tests
  - `src/services/streaks/streakMath.ts`: `advanceStreak(prev, today)` (first/same-day/yesterday/gap)
  - unit tests with explicit dates
  - _Requirements: 1.2–1.5, 5.3_

- [x] 3. streakRepository (`src/repositories/streakRepository.ts`)
  - `getByKey(userId, seriesId|null)`, `upsert(userId, seriesId|null, state)` (ON CONFLICT), `listForUser(userId)` (daily + per-series with representative subject label)
  - _Requirements: 1.1, 2.1, 3.1, 3.2_

- [x] 4. CompletionEvent extension
  - Add optional `streaks?: { daily: number; series?: number }` to `CompletionEvent` (foundational type) for achievements to read
  - _Requirements: 4.1, 4.2_

- [x] 5. streakService
  - `applyForCompletion(userId, seriesId|null, today)` → new current; `onTaskCompleted(event)` (daily + optional per-series; stash on event.streaks); `getStreaks(userId)`
  - Derive `today` from the user's timezone: `today = userTime.localCalendarDate(userTime.resolveTimezone(user.settings.timezone))` (one value reused for all applyForCompletion calls); `advanceStreak` stays timezone-agnostic
  - Depends on user-timezone (`src/services/time/userTime.ts` + `settings.timezone`) — implement that spec first
  - _Requirements: 1, 2, 3.3, 4, 5.2, 5.3_

- [x] 6. Registration + routes
  - Register streak listener in `registerAllListeners` BEFORE achievements (ordering documented)
  - `streaksController.get`; `GET /api/streaks` behind authMiddleware; wire in app.ts
  - _Requirements: 3.1, 3.4, 5.1_

- [x] 7. Tests
  - Unit: advanceStreak cases
  - Integration: daily current 1; yesterday→2 (simulate via direct date set); gap→reset+longest retained; same-day no-op; per-series advance + independence + non-repeatable no series; GET /api/streaks shape/label/empty/401/scope. Suite resets listeners to streak listener.
  - `today` comes from the user's timezone via `userTime.localCalendarDate(...)`; simulated "yesterday"/"gap" set `last_completed_date` relative to the user's local today (UTC in the test env)
  - Depends on user-timezone being implemented first
  - _Requirements: 1–5_

- [x] 8. Verify — typecheck + full `npm test` green
