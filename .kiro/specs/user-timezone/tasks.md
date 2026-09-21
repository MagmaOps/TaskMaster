# Implementation Plan: User Timezone

## Overview

This plan retrofits per-user timezone handling into the existing TaskMaster backend
(`routes → controller → service → repository`, plus a new pure utility beneath the
service layer). Work proceeds bottom-up so the suite stays green throughout: add the
test dependency, extend shared types, build the pure `userTime` utility (fully tested
in isolation), then thread the resolved timezone through the write paths
(repository → service → controller → routes), the endpoint tests, and finally the
read paths (`weight.ts` and `taskService`). A final verification task confirms all 81
existing tests still pass alongside the new ones and that the backward-compatibility
guarantees (migration count, runtime deps) hold.

Language: TypeScript (the design specifies concrete TypeScript signatures — no
pseudocode — so no language selection is required).

Property tests use `fast-check` (devDependency only) at ≥ 100 runs each and are tagged
`// Feature: user-timezone, Property N: ...`. Each property references its number and the
requirement clause it validates, per the design's Correctness Properties section.

## Tasks

- [x] 1. Add `fast-check` as a test-only dependency
  - Run `npm install -D fast-check` in `task-master-server`
  - Verify `fast-check` appears in `devDependencies` of `package.json` and NOT in `dependencies`
  - Confirm the `dependencies` block is otherwise unchanged (runtime deps untouched)
  - _Requirements: 7.5_

- [x] 2. Extend the settings type and read-time coalescing in `src/types/index.ts`
  - Add `timezone: string` to the `UserSettings` interface (IANA identifier; `'UTC'` default)
  - Add `timezone: 'UTC'` to `DEFAULT_USER_SETTINGS`
  - Update `toPublicUser` to coalesce the returned `settings.timezone` via `resolveTimezone(row.settings.timezone)` (read-time default, no backfill) so a stored valid value is reported unchanged and a missing/empty/invalid value is reported as `'UTC'`
  - Import `resolveTimezone` from `../services/time/userTime` (created in task 3)
  - _Requirements: 3.1, 3.3, 3.4_

- [x] 3. Create the pure `Timezone_Service` utility `src/services/time/userTime.ts`
  - Export `DEFAULT_TIMEZONE = 'UTC'`
  - `resolveTimezone(tz: unknown): string` — returns `tz` unchanged when it is a non-empty string ≤ 64 chars accepted by `Intl.DateTimeFormat`; otherwise `'UTC'` (catches the `RangeError` for unknown zones)
  - `isValidTimezone(tz: unknown): boolean` — predicate form for the express-validator custom validator (non-empty string, ≤ 64 chars, Intl-acceptable)
  - `localCalendarDate(tz: string, now?: Date): string` — `'YYYY-MM-DD'` in `tz` relative to `now` (defaults to system instant) via `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })` / `formatToParts`; invalid `tz` falls back to UTC
  - `zonedNow(tz: string, now?: Date): Date` — same instant with wall-clock components (y/m/d/h/m/s) reflecting `tz` via `formatToParts`; invalid `tz` falls back to UTC
  - `nextCalendarDate(dateStr: string): string` — DST-safe next day via `Date.UTC(y, m-1, d, 12)` + `MS_PER_DAY` then re-read UTC y/m/d
  - Built-in `Intl` only; no runtime npm dependency
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 4. Test the `userTime` utility
  - [x]* 4.1 Write property tests for `userTime` in `src/services/time/userTime.test.ts` (fast-check, ≥ 100 runs each)
    - **Property 1: resolveTimezone is idempotent and always yields a usable zone on valid input** — arbitrary picks from a curated list of valid IANA zones return unchanged, are Intl-acceptable, and `resolveTimezone(resolveTimezone(tz)) === resolveTimezone(tz)`
    - **Property 2: resolveTimezone falls back to UTC on any invalid input** — `fc.anything()` filtered to invalid inputs plus `null`, `''`, 65-char strings, `'Not/AZone'` → `'UTC'`
    - **Property 3: localCalendarDate is always a valid YYYY-MM-DD for any zone and instant** — `fc.date()` × arbitrary zone matches `^\d{4}-\d{2}-\d{2}$`, is a real date, and equals the date part of `zonedNow`
    - **Property 4: an invalid timezone computes the same local date as UTC** — invalid zone × `fc.date()` → `localCalendarDate(invalid, now) === localCalendarDate('UTC', now)` and `zonedNow` matches
    - **Property 5: nextCalendarDate advances exactly one calendar day** — `fc.date()`-derived date strings plus leap/DST edges advance one day; N-day chains advance N days
    - Tag each with `// Feature: user-timezone, Property N: ...`
    - **Validates: Requirements 2.1, 2.2, 3.1, 3.3, 4.1, 4.2, 4.4, 4.6, 4.7, 4.8, 6.2, 7.3**
  - [x]* 4.2 Write example/edge-case unit tests for `userTime`
    - DST divergence: an instant that is one calendar day in `Asia/Tokyo` but the previous day in `UTC` yields the two expected distinct dates
    - Injected clock: fixed injected `Date` yields a deterministic date; omitting the clock yields today's date (validates the 2.1/2.2 validation predicate behavior and clock injection)
    - `nextCalendarDate` edges: `'2024-02-28'→'2024-02-29'→'2024-03-01'`, `'2023-12-31'→'2024-01-01'`, a spring-forward DST day → next day
    - `resolveTimezone` fallback edges: `undefined`, `null`, `''`, `'   '`, 65-char string, `'Mars/Phobos'` → `'UTC'`
    - _Requirements: 2.1, 2.2, 4.4, 4.5, 4.8_

- [x] 5. Extend `userRepository` for timezone persistence — `src/repositories/userRepository.ts`
  - Add `updateSettings(userId, settings: UserSettings): Promise<UserRow>` using parameterized `UPDATE users SET settings = $2, updated_at = now() WHERE id = $1 RETURNING *` writing `JSON.stringify(settings)`
  - Extend `createPasswordUser` and `createOAuthUser` to accept an optional resolved `timezone` and insert `JSON.stringify({ ...DEFAULT_USER_SETTINGS, timezone: timezone ?? DEFAULT_TIMEZONE })` instead of the bare default
  - _Requirements: 1.1, 1.4, 1.5, 1.6_

- [x] 6. Extend `authService` for timezone write paths — `src/services/auth/authService.ts`
  - Add `updateTimezone(userId, tz)`: load the user, compute `resolveTimezone(tz)` defensively, merge `{ ...user.settings, timezone }`, call `userRepo.updateSettings`, return `toPublicUser(updated)`
  - Extend `register` / `login` / `loginWithGoogle` to accept an optional `timezone` param, resolve it with `resolveTimezone` (invalid → `'UTC'`), and pass the resolved value into `createPasswordUser` / `createOAuthUser`
  - _Requirements: 1.1, 1.5, 1.6, 2.3_

- [x] 7. Extend `authController` to thread timezone — `src/controllers/authController.ts`
  - Add `updateTimezone(req, res, next)`: read `req.body.timezone`, call `authService.updateTimezone(req.userId, timezone)`, respond `{ success: true, data: { user } }` (same envelope as `me`)
  - Extend `register` / `login` / `google` to read `timezone` from `req.body` and pass it into the corresponding `authService` call
  - _Requirements: 1.2, 1.5, 3.5_

- [x] 8. Wire the auth routes — `src/routes/authRoutes.ts`
  - Add `PATCH /api/auth/me` guarded by `authMiddleware`, then `validate([ body('timezone').custom(isValidTimezone).withMessage('Invalid timezone') ])`, then `authController.updateTimezone`
  - Add `body('timezone').optional().isString()` (no `.custom` rejection) to the `/register`, `/login`, and `/google` validators so these paths never 400 on the timezone field
  - Import `isValidTimezone` from `../services/time/userTime`
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 3.5_

- [x] 9. Checkpoint — write path green
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Endpoint integration tests — `src/routes/authRoutes.test.ts` (Supertest, following existing conventions)
  - [x]* 10.1 Add timezone endpoint integration tests
    - `PATCH /api/auth/me` with a valid zone → 200, `settings.timezone` updated, other settings keys preserved
    - `PATCH /api/auth/me` with an invalid zone → 400 `VALIDATION_ERROR`; a subsequent `GET /me` shows the prior value unchanged
    - `PATCH /api/auth/me` without auth → 401, no `settings` returned
    - `POST /register` with a valid zone → stored; without a zone → `'UTC'`; with garbage → 201 and `'UTC'`
    - `GET /me` for a user whose stored settings lack `timezone` → reports `'UTC'`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 2.3, 3.4, 3.5_

- [x] 11. Rezone the weight calendar-day comparison — `src/services/tasks/weight.ts`
  - Extend `WeightInput` with an optional `localToday?: string` (`'YYYY-MM-DD'`); document that when omitted it defaults to the server-local calendar day of `now` (== UTC in the CI environment)
  - In `calculateWeightBreakdown`, compute `localToday = input.localToday ?? serverLocalDay(now)` where `serverLocalDay` reuses the existing local `getFullYear/getMonth/getDate` formatting
  - Replace the repeatable-due-today test `isSameLocalDay(dueMoment, now)` with the string comparison `input.isRepeatable && input.dueDate && input.dueDate === localToday`
  - Keep age (`now - createdAt`) and due-proximity (`dueMoment - now` hours) instant math unchanged
  - _Requirements: 5.2, 5.3, 5.4_

- [x] 12. Weight tests for timezone behavior — `src/services/tasks/weight.test.ts` (additions)
  - [x]* 12.1 Add weight property tests (fast-check, ≥ 100 runs each)
    - **Property 7: UTC (or unset) timezone reproduces the pre-change baseline weight** — arbitrary `WeightInput` → weight with `localToday` omitted equals weight with `localToday = localCalendarDate('UTC', now)`
    - **Property 8: repeatable-due-today follows the user's local calendar day** — arbitrary repeatable task + zone/instant → doubling applied iff `dueDate === localCalendarDate(tz, now)`; at a boundary instant `Asia/Tokyo` vs `UTC` diverge on "due today"
    - Tag each with `// Feature: user-timezone, Property N: ...`
    - **Validates: Requirements 5.3, 5.5, 7.1**
  - [x]* 12.2 Add a Tokyo-vs-UTC example test and confirm existing suite unchanged
    - Concrete companion to Property 8: a repeatable task at a boundary instant doubles for Tokyo and not for UTC
    - Confirm the existing `weight.test.ts` assertions remain unedited and green
    - _Requirements: 5.3, 7.1_

- [x] 13. Thread timezone through `taskService` — `src/services/tasks/taskService.ts`
  - Extend `UserWeightContext` with `timezone: string`, `now: Date` (zoned), and `localToday: string`
  - In `loadUserWeightContext`, resolve `resolveTimezone(user?.settings.timezone)` once, then compute `zonedNow(tz)` and `localCalendarDate(tz)` from a single instant so the whole computation shares one "now"
  - In `buildWeightInput`, pass `now: ctx.now` and `localToday: ctx.localToday` into the `WeightInput`
  - In `deferTask`, resolve the user's zone (reuse the loaded context/user): `later_today → patch.dueDate = localCalendarDate(tz)`, `tomorrow → patch.dueDate = nextCalendarDate(localCalendarDate(tz))`, `sometime_later` unchanged (downgrade priority, clear due date/time)
  - Invalid/unset zone resolves to `'UTC'` so behavior matches the current UTC-server outcome
  - _Requirements: 5.1, 5.5, 6.1, 6.2, 6.3, 6.4, 7.2, 7.3_

- [x] 14. Defer/weight service tests for timezone — `src/services/tasks/`
  - [x]* 14.1 Add defer + weight-context service tests
    - Defer with a non-UTC zone: `later_today` sets `dueDate = localCalendarDate(zone)`, `tomorrow` sets `nextCalendarDate(localCalendarDate(zone))`, `sometime_later` downgrades priority and clears due (zone-independent)
    - Defer with unset/invalid zone → outcomes equal the UTC outcomes
    - Weight: Tokyo vs UTC "due today" divergence yields different weights; age/due-proximity for a fixed instant are unaffected by the zone label
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.2_

- [x] 15. Settings-merge property test
  - [x]* 15.1 Add the settings-merge property test (fast-check, ≥ 100 runs) in `src/services/time/userTime.test.ts` or `src/services/auth/authService.test.ts`
    - **Property 6: updating the timezone preserves all other settings** — arbitrary `UserSettings` × valid zone → only the `timezone` key differs between input and output; every other key/value is unchanged
    - Tag with `// Feature: user-timezone, Property 6: ...`
    - **Validates: Requirements 1.4**

- [x] 16. Final verification
  - Run `npm run typecheck` and resolve any type errors
  - Run the full `npm test` suite: all 81 previously passing tests across 12 suites must still pass with 0 failures, plus the new tests
  - Assert the migration directory still contains exactly the 4 existing migration files (no new migration added)
  - Assert the `dependencies` block of `package.json` is unchanged (runtime deps untouched); `fast-check` is present only under `devDependencies`
  - _Requirements: 7.4, 7.5, 7.6_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never optional.
- Every task references specific requirement clauses for traceability.
- Property-test sub-tasks reference the design's Correctness Properties by number and use the tag `// Feature: user-timezone, Property N: ...`; each runs ≥ 100 fast-check iterations.
- The build order keeps the suite green: the pure utility is added and tested before any consumer imports it, write paths land before their integration tests, and the weight/`taskService` read-path changes preserve the UTC-equivalent default so existing fixtures do not change.
- Streaks, recurrence, and analytics are out of scope and intentionally excluded.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "3"] },
    { "id": 1, "tasks": ["2", "4.1", "4.2", "5", "11"] },
    { "id": 2, "tasks": ["6", "12.1", "12.2", "15.1"] },
    { "id": 3, "tasks": ["7", "13"] },
    { "id": 4, "tasks": ["8", "14.1"] },
    { "id": 5, "tasks": ["10.1"] },
    { "id": 6, "tasks": ["16"] }
  ]
}
```
