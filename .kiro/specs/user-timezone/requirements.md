# Requirements Document

## Introduction

TaskMaster is a global, multi-user SaaS in which task ordering (weight) and daily behaviors depend on "now" and "today". Today these are computed in the server's local timezone, which is incorrect for a distributed user base: a user in Tokyo completing a task at 09:00 local time can be mis-attributed to a different calendar day, and weight due-proximity / "due today" comparisons pivot on a "today" that must be the user's local today rather than the server's.

This feature introduces per-user timezone handling as a standalone abstraction. It defines the backend contract for receiving, validating, storing, and returning a user's IANA timezone, and a server-side utility that yields the user's current local calendar date and zoned "now". It then retrofits the existing weight algorithm and deferral logic to compute "now"/"today" in the user's timezone. Downstream features (streaks, recurrence, analytics) consume this abstraction but are out of scope here.

Scope boundaries:
- Backend only. Frontend work is a later spec; this document covers only the API contract the client calls.
- No streaks logic (separate spec).
- No database migration (the `users.settings` column is already JSONB).
- No new runtime npm dependency (uses the built-in `Intl` API).

## Glossary

- **TaskMaster_Server**: The Node.js/Express backend application that exposes the API and computes weight and deferral behavior.
- **User_Timezone**: An IANA timezone identifier (e.g. `Asia/Tokyo`, `America/New_York`, `UTC`) associated with a single user.
- **IANA_Timezone_Identifier**: A timezone name from the IANA Time Zone Database that the JavaScript `Intl.DateTimeFormat` API accepts as its `timeZone` option.
- **User_Settings**: The existing JSONB document stored in the `users.settings` column, holding user preferences (theme, toggles). This feature adds a `timezone` key to this document.
- **Default_Timezone**: The `User_Timezone` value used when a user has no timezone stored: the literal string `UTC`.
- **Timezone_Service**: A server-side utility module that computes a user's local calendar date and zoned "now" from a stored `User_Timezone`.
- **Local_Calendar_Date**: A calendar date in the format `YYYY-MM-DD` representing the current day in a user's `User_Timezone`.
- **Zoned_Now**: The current instant expressed as the wall-clock date and time in a user's `User_Timezone`.
- **Injected_Clock**: A supplier of the current instant that defaults to the real system time and can be replaced in tests for deterministic results.
- **Weight_Algorithm**: The existing pure function set in `src/services/tasks/weight.ts` that computes task weight from an injectable `now`.
- **Task_Service**: The existing service in `src/services/tasks/taskService.ts` that orchestrates task operations, including `deferTask`.
- **Profile_Endpoint**: The existing `GET /api/auth/me` endpoint that returns the authenticated user's profile including `settings`.

## Requirements

### Requirement 1: Store and update the user's timezone

**User Story:** As a user of TaskMaster, I want my timezone stored on my account, so that daily calculations reflect my local time regardless of where the server runs.

#### Acceptance Criteria

1. THE TaskMaster_Server SHALL persist the User_Timezone as a `timezone` key within the User_Settings JSONB document in the `users.settings` column.
2. WHEN a request supplies for the authenticated user a timezone value that matches an entry in the IANA time zone database (an IANA_Timezone_Identifier), THE TaskMaster_Server SHALL store that value as the user's User_Timezone and respond with HTTP status 200.
3. IF a request supplies a timezone value that does not match any entry in the IANA time zone database, THEN THE TaskMaster_Server SHALL reject the request, leave the User_Settings document unchanged, and respond with an error indicating the timezone value is invalid.
4. WHEN the authenticated user's User_Timezone is updated, THE TaskMaster_Server SHALL preserve all other existing keys and their values in the User_Settings document unchanged.
5. WHEN an IANA_Timezone_Identifier is supplied at registration or at login, THE TaskMaster_Server SHALL store that value as the user's User_Timezone.
6. IF no timezone value is supplied at registration, THEN THE TaskMaster_Server SHALL store `UTC` as the user's User_Timezone.

### Requirement 2: Validate the supplied timezone

**User Story:** As a user, I want an invalid timezone value to be rejected rather than stored, so that my daily calculations never break due to a bad value.

#### Acceptance Criteria

1. WHEN a supplied timezone value is a non-empty string of at most 64 characters that `Intl.DateTimeFormat` accepts as an IANA_Timezone_Identifier, THE TaskMaster_Server SHALL treat the value as valid and use it as the User_Timezone.
2. IF a supplied timezone value fails `Intl.DateTimeFormat` validation, is not a string, is empty, or exceeds 64 characters, THEN, during an explicit timezone update, THE TaskMaster_Server SHALL reject the request with HTTP status 400 and a validation error indicating the timezone is invalid, and SHALL leave the previously stored User_Timezone unchanged.
3. WHERE a timezone value is supplied during registration or login AND that value fails `Intl.DateTimeFormat` validation, is not a string, is empty, or exceeds 64 characters, THE TaskMaster_Server SHALL ignore the supplied value, complete the registration or login successfully, and store the Default_Timezone (UTC) as the User_Timezone.

### Requirement 3: Default and return the user's timezone

**User Story:** As a client application, I want to read the user's timezone from the profile, so that I can display and pre-fill the current setting.

#### Acceptance Criteria

1. IF a user has no `timezone` key stored in User_Settings, THEN THE TaskMaster_Server SHALL treat the user's User_Timezone as the Default_Timezone (the literal string "UTC").
2. WHEN the Profile_Endpoint returns a user profile, THE TaskMaster_Server SHALL include the User_Timezone as a value within the returned `settings` object.
3. WHERE a user has a `timezone` key stored in User_Settings, WHEN the Profile_Endpoint returns the profile, THE TaskMaster_Server SHALL report the User_Timezone as the stored `timezone` value unchanged.
4. WHERE a user has no `timezone` key stored in User_Settings, WHEN the Profile_Endpoint returns the profile, THE TaskMaster_Server SHALL report the User_Timezone as the Default_Timezone (the literal string "UTC").
5. IF the Profile_Endpoint is invoked without a valid authenticated user, THEN THE TaskMaster_Server SHALL reject the request without returning the `settings` object, and SHALL return a response indicating the request is unauthenticated.

### Requirement 4: Compute the user's local date and zoned now

**User Story:** As a backend developer, I want a utility that yields a user's local calendar date and zoned now, so that services can compute daily behavior in the user's timezone.

#### Acceptance Criteria

1. WHEN the Timezone_Service is given a user's User_Timezone, THE Timezone_Service SHALL return that user's Local_Calendar_Date as a string in `YYYY-MM-DD` format.
2. WHEN the Timezone_Service is given a user's User_Timezone, THE Timezone_Service SHALL return that user's Zoned_Now as the date-and-time value of the applicable instant expressed in the User_Timezone.
3. THE Timezone_Service SHALL compute Local_Calendar_Date and Zoned_Now using the built-in `Intl` API with the User_Timezone as the `timeZone`, without any fixed UTC offset and without any additional runtime npm dependency.
4. WHERE the Timezone_Service is given an Injected_Clock, THE Timezone_Service SHALL compute Local_Calendar_Date and Zoned_Now relative to the instant supplied by the Injected_Clock.
5. WHEN no Injected_Clock is provided, THE Timezone_Service SHALL compute Local_Calendar_Date and Zoned_Now relative to the current system instant.
6. IF the Timezone_Service is given a User_Timezone value that is not a valid IANA_Timezone_Identifier, THEN THE Timezone_Service SHALL compute Local_Calendar_Date and Zoned_Now using the Default_Timezone of UTC.
7. IF the User_Timezone value is null, an empty string, or a non-empty string that does not match any IANA_Timezone_Identifier, THEN THE Timezone_Service SHALL treat it as invalid and apply the Default_Timezone of UTC.
8. WHEN the applicable instant falls within a daylight-saving transition for the User_Timezone, THE Timezone_Service SHALL resolve that instant to exactly one Local_Calendar_Date and Zoned_Now as determined by the IANA rules in effect for the User_Timezone at that instant.

### Requirement 5: Weight calculation uses the user's timezone

**User Story:** As a user, I want task weight to reflect my local today, so that "due today", overdue, and repeatable-due-today contributions match my calendar.

#### Acceptance Criteria

1. WHEN Task_Service computes weight for a user's tasks, THE Task_Service SHALL supply the Weight_Algorithm with a single Zoned_Now derived from that user's User_Timezone for the whole computation.
2. WHEN the Weight_Algorithm evaluates due proximity or overdue contribution for a task, THE Weight_Algorithm SHALL measure time-until-due relative to the user's Zoned_Now.
3. WHEN the Weight_Algorithm evaluates whether a repeatable task is due today, THE Weight_Algorithm SHALL treat the task as due today only when the task due date is the same calendar day as the user's Local_Calendar_Date.
4. WHEN the Weight_Algorithm computes task age, THE Weight_Algorithm SHALL measure age relative to the user's Zoned_Now.
5. IF the user's User_Timezone is unset or invalid, THEN THE Task_Service SHALL supply the Weight_Algorithm with a Zoned_Now derived from the Default_Timezone of UTC.

### Requirement 6: Deferral uses the user's timezone

**User Story:** As a user, I want "later today" and "tomorrow" deferral to use my local day, so that a deferred task lands on the correct date for me.

#### Acceptance Criteria

1. WHEN a user defers a task with the `later_today` option, THE Task_Service SHALL set the task due date to the user's Local_Calendar_Date, where Local_Calendar_Date is the calendar date obtained by resolving the current instant into the user's User_Timezone.
2. WHEN a user defers a task with the `tomorrow` option, THE Task_Service SHALL set the task due date to the calendar date that immediately follows the user's Local_Calendar_Date within the user's User_Timezone.
3. WHEN a user defers a task with the `sometime_later` option, THE Task_Service SHALL lower the task priority by one level (high to medium, medium to low, low remains low) and clear the task due date and due time, independent of any User_Timezone.
4. IF a user's User_Timezone is unset or is not a valid timezone identifier WHEN the user defers a task with the `later_today` or `tomorrow` option, THEN THE Task_Service SHALL resolve Local_Calendar_Date using the Default_Timezone of UTC and complete the deferral without error.

### Requirement 7: Backward compatibility

**User Story:** As an existing user without a timezone set, I want the system to behave exactly as before, so that no current behavior or test regresses.

#### Acceptance Criteria

1. WHERE a user has no User_Timezone stored, WHEN Task_Service computes weight for a task, THE Task_Service SHALL produce a weight value identical to the value produced when User_Timezone equals the Default_Timezone of UTC.
2. WHERE a user has no User_Timezone stored, WHEN Task_Service defers a task, THE Task_Service SHALL compute the deferral outcome identical to the outcome produced when User_Timezone equals the Default_Timezone of UTC.
3. IF a stored User_Timezone value is absent, null, or an empty string, THEN THE Task_Service SHALL resolve the effective timezone to the Default_Timezone of UTC without raising an error.
4. THE TaskMaster_Server SHALL introduce the timezone abstraction with zero added database migration files beyond the 4 existing migrations.
5. THE TaskMaster_Server SHALL introduce the timezone abstraction with zero added entries in the runtime dependencies list of package.json.
6. WHEN the existing backend test suite is executed after this feature is implemented, THE TaskMaster_Server SHALL report all 81 currently passing tests across 12 suites as passing, with 0 failures.
