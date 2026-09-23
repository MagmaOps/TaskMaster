# Frontend Profile & Settings — Requirements

## Introduction

This is the **fourth and last of the sequential frontend specs**. It builds the two remaining bottom-nav destinations delivered as placeholders by the app-shell spec:

- **Profile** — a read-only dashboard of the user's progress: unlocked achievements, streaks (daily + per-repeatable-series), virtual-economy balance, and per-project completion analytics.
- **Settings** — the editors for the user's preferences: theme (light / dark / system), Focus Mode, achievement-toast visibility, project-priority weighting, timezone, and the premium-only weight-visibility toggle.

It reuses the Modal / Button / Input / Spinner primitives, the Toast surface, `AuthContext`, and the existing contexts. It consumes the feature-complete backend read endpoints unchanged. **It requires one small backend change** (a settings PATCH) — see "Backend contract" below; that change is called out for the user to approve before design/implementation.

### Backend contract consumed (confirmed from source)

Read endpoints, all behind `authMiddleware`, scoped to the caller, returning the `{ success, data }` envelope:

- `GET /api/achievements` → `data: AchievementRow[]`, newest first. `AchievementRow = { id, type, unlocked_at, data }`. `type` is a slug like `first_task_completed`, `daily_streak_7|14|30|90`, `repeatable_streak_7|30|100`, `accountable_procrastination`, `high_weight_completed`, `productivity_burst_10`. `data` may carry `task_id`, `series_id`, or `local_date`.
- `GET /api/streaks` → `data: { daily: StreakState | null, series: StreakSeriesEntry[] }`. `StreakState = { current, longest, lastCompletedDate }` (`lastCompletedDate` is `'YYYY-MM-DD' | null`). `StreakSeriesEntry = { seriesId, label, current, longest, lastCompletedDate }`, ordered by most recent activity.
- `GET /api/economy` → `data: { balance: number, earnRate: number, tier: 'free' | 'premium' }`.
- `GET /api/analytics/projects` → `data: ProjectAnalytics[]`, ordered by `priorityOrder` ASC. `ProjectAnalytics = { projectId, name, priorityOrder, color, tasksCompleted, weightCompleted, lastCompletionDate }` (`lastCompletionDate` is the user-zone `'YYYY-MM-DD' | null`).
- `GET /api/auth/me` → `data: { user }`. The `user.settings` object is the source of truth for all preferences: `{ project_priority_enabled, achievement_toasts_enabled, focus_mode_enabled, weight_visibility_enabled, theme, timezone }`. `user.tier` gates premium features.

### Backend change required (to be approved before implementation)

Persisting any preference other than `timezone` is **not currently supported**. The only settings write endpoint is `PATCH /api/auth/me`, whose validator accepts **`timezone` only** (`authRoutes.ts` / `authController.updateTimezone` → `authService.updateTimezone`). The service already merges into the full settings JSONB via `userRepository.updateSettings`, so the storage path exists; only the HTTP contract is narrow.

**Proposed change:** widen `PATCH /api/auth/me` to accept a partial settings body — any subset of `{ theme, focus_mode_enabled, achievement_toasts_enabled, project_priority_enabled, weight_visibility_enabled, timezone }` — validate each provided key, merge over the current settings (preserving unspecified keys), and return the updated `user`. `weight_visibility_enabled` must be **rejected/ignored for free-tier users** server-side (defense in depth; the UI also hides it). This keeps a single, idempotent settings endpoint rather than one route per toggle.

The exact backend edit (validator + controller + service) will be scoped in the design; **the user should confirm this backend change before it is made.** No other backend changes are anticipated.

## Glossary

- **Preference / setting:** a single key in `user.settings`.
- **Effective theme:** the resolved `light` / `dark` after applying the OS setting for the `system` preference (owned by `ThemeProvider`).
- **Series streak:** a streak for one repeatable task series (`repeat_series_id`), distinct from the global daily streak.
- **Weight visibility:** premium-only preference that reveals numeric task weights + breakdowns in the task views.
- **Locked achievement:** a defined achievement the user has not yet unlocked (shown greyed in the gallery).

## Requirements

### Requirement 1 — Profile data layer

**User Story:** As a user, I want the Profile page to load my achievements, streaks, economy, and analytics reliably, so that I can see my progress in one place.

#### Acceptance Criteria

1. THE app SHALL provide typed API wrappers for `GET /api/achievements`, `GET /api/streaks`, `GET /api/economy`, and `GET /api/analytics/projects`, each unwrapping `data` and throwing a normalized `ApiError` (matching the existing `api/` wrapper pattern).
2. WHEN the Profile page mounts (authenticated) THEN it SHALL load all four resources, and each section SHALL render independently as its data resolves (one failing request SHALL NOT blank the whole page).
3. WHILE a section is loading THE page SHALL show a loading state for that section; on failure THE section SHALL show a friendly, retryable error derived from the error envelope.
4. THE Profile page SHALL NOT perform any writes.
5. THE page SHALL be responsive down to 320px.

### Requirement 2 — Achievements gallery

**User Story:** As a user, I want to see the achievements I've unlocked, so that I feel rewarded for my progress.

#### Acceptance Criteria

1. THE Profile page SHALL render the user's unlocked achievements from `GET /api/achievements`, each with a human-readable title, description, and unlock date (formatted in a friendly, locale-aware way).
2. EACH achievement `type` SHALL map to a readable title/description via a frontend catalog (the backend returns slugs, not display copy); an unknown `type` SHALL fall back to a humanized version of the slug rather than erroring.
3. THE gallery SHALL also show defined-but-not-yet-unlocked achievements in a locked (greyed) state to convey what is achievable; a locked achievement SHALL NOT show an unlock date. The frontend catalog SHALL cover the defined types: `first_task_completed`, `daily_streak_7|14|30|90`, `repeatable_streak_7|30|100`, `accountable_procrastination`, `high_weight_completed`, `productivity_burst_10`. An unlocked `type` absent from the catalog (future backend addition) SHALL render as unlocked with a humanized-slug fallback rather than erroring.
4. WHEN the user has no unlocked achievements THEN the section SHALL show an encouraging empty state.
5. THE gallery SHALL be keyboard- and screen-reader-accessible (each item's locked/unlocked state conveyed non-visually).

### Requirement 3 — Streaks display

**User Story:** As a user, I want to see my current and longest streaks, so that I stay motivated to keep going.

#### Acceptance Criteria

1. THE Profile page SHALL show the daily streak's current and longest run from `GET /api/streaks` (`data.daily`); WHEN `daily` is null THEN it SHALL show a zero/empty state, not an error.
2. THE page SHALL list per-series streaks (`data.series`), each showing its label and its current + longest run, ordered as returned (most recent activity first).
3. WHEN there are no series streaks THEN the series area SHALL be omitted or show a brief empty note.
4. Streak figures SHALL be presented as read-only counts with clear labels; no numeric weight is shown here.

### Requirement 4 — Virtual economy balance

**User Story:** As a user, I want to see my currency balance, so that I understand what I've earned.

#### Acceptance Criteria

1. THE Profile page SHALL show the currency `balance` from `GET /api/economy`, clearly labeled as the virtual/earned currency.
2. WHERE the user is premium THE page MAY indicate the boosted `earnRate` (e.g. "earning faster"); for free users it SHALL NOT imply the rate is a penalty.
3. THE balance SHALL be read-only (spending/store is out of scope per PRD).

### Requirement 5 — Per-project analytics

**User Story:** As a user, I want to see how much I've completed per project, so that I understand where my effort goes.

#### Acceptance Criteria

1. THE Profile page SHALL render one row per project from `GET /api/analytics/projects`, in the returned order, showing the project name, its color swatch (when set), completed-task count, and total completed weight.
2. EACH row SHALL show the last completion date (`lastCompletionDate`) formatted friendly, or a clear "no completions yet" state when null.
3. WHEN the user has only the Unassigned project and no completions THEN the section SHALL show an encouraging empty state.
4. THE analytics section SHALL be read-only.
5. Note on weight numbers: `weightCompleted` is a historical completion metric, not a live task weight; it is shown to all users here (it is not the premium "weight visibility" feature, which concerns live task weights — see Requirement 10). This distinction SHALL be reflected in labeling so it does not read as the hidden live-weight algorithm.

### Requirement 6 — Settings data layer (server-persisted preferences)

**User Story:** As a user, I want my settings saved to my account, so that they follow me across devices.

#### Acceptance Criteria

1. THE app SHALL treat `user.settings` (from `AuthContext`) as the source of truth for all preferences, and SHALL provide a way to persist a preference change to the backend via the settings PATCH and update the in-memory `user` on success.
2. WHEN a preference change is persisted successfully THEN `AuthContext.user.settings` SHALL reflect the new value (either from the PATCH response or a profile re-fetch), so all consumers (ThemeProvider, task views, toasts) update.
3. WHEN a preference PATCH fails THEN the UI SHALL revert the control to its prior value and show a friendly error; local state SHALL NOT drift from the server.
4. THE existing `SettingsContext` (which currently persists only theme to localStorage, disconnected from `user.settings`) SHALL be reconciled so theme is driven by the authenticated user's setting when available, without regressing the pre-paint anti-flash behavior or the unauthenticated experience. (The localStorage value MAY remain as a fast pre-auth default / anti-flash source.)
5. Preference changes SHALL be individually persistable (changing one toggle SHALL NOT require re-sending unrelated settings), consistent with the partial-PATCH backend contract.

### Requirement 7 — Theme setting

**User Story:** As a user, I want to choose light, dark, or system theme, so that the app matches my preference.

#### Acceptance Criteria

1. THE Settings page SHALL offer a theme selector with `light`, `dark`, and `system` options reflecting the current effective preference.
2. WHEN the user selects a theme THEN the app SHALL apply it immediately (via the existing theme mechanism) AND persist it to `user.settings.theme`.
3. THE `system` option SHALL continue to follow the OS setting live (existing `ThemeProvider` behavior SHALL be preserved).
4. Dark mode already works app-wide; this requirement SHALL NOT reimplement theming, only add the persisted selector.

### Requirement 8 — Focus Mode toggle

**User Story:** As a user, I want a Focus Mode that shows only my top task, so that I can reduce distraction.

#### Acceptance Criteria

1. THE Settings page SHALL offer a Focus Mode on/off toggle bound to `user.settings.focus_mode_enabled`.
2. WHEN toggled THEN the app SHALL persist the change; the toggle SHALL reflect the persisted value.
3. WHEN Focus Mode is enabled THEN the Tasks view ("What's Next?") SHALL show only the single top task and hide the rest of the list; WHEN disabled THEN the full list SHALL show. (This wires the setting into the existing task view built in the task-views spec.)
4. THE Focus Mode behavior change SHALL be keyboard- and screen-reader-accessible and SHALL not break Quick-Add or the action modal.

### Requirement 9 — Notification / toast preferences

**User Story:** As a power user, I want to turn off achievement celebration toasts, so that they don't interrupt me.

#### Acceptance Criteria

1. THE Settings page SHALL offer an achievement-toasts on/off toggle bound to `user.settings.achievement_toasts_enabled`.
2. WHEN disabled THEN celebration toasts SHALL NOT appear on task completion (the task-views spec already gates on this flag; this requirement provides the editor and ensures the flag round-trips).
3. THE Settings page SHALL offer a project-priority-weighting on/off toggle bound to `user.settings.project_priority_enabled` (ON by default), with a short explanation that it influences task ordering; changing it SHALL persist and take effect on the next task-list fetch (the server owns weight).

### Requirement 10 — Weight visibility (premium-gated)

**User Story:** As a premium user, I want to see the weight and breakdown of each task, so that I understand the algorithm.

#### Acceptance Criteria

1. WHERE `user.tier === 'premium'` THE Settings page SHALL show a weight-visibility on/off toggle bound to `user.settings.weight_visibility_enabled`.
2. WHERE `user.tier === 'free'` THE toggle SHALL be hidden (or shown disabled with a brief "premium" note); the app SHALL NOT allow a free user to enable it, and the backend SHALL also reject it (defense in depth per the backend-change requirement).
3. WHEN a premium user enables weight visibility THEN task cards SHALL reveal the numeric weight and, on demand, the weight breakdown (`age/base`, priority, project, due-date, deferral, repeatable, total — the `weightBreakdown` already returned by the task API); WHEN disabled THEN weights SHALL be hidden.
4. THE weight-visibility wiring SHALL reuse the `weightBreakdown` data already present on `TaskDTO`; it SHALL NOT require a new task endpoint.

### Requirement 11 — Timezone setting

**User Story:** As a user, I want to set my timezone, so that streaks and due dates use my local day.

#### Acceptance Criteria

1. THE Settings page SHALL show the current timezone (`user.settings.timezone`) and allow changing it to a valid IANA identifier.
2. WHEN changed THEN the app SHALL persist it via the settings PATCH (the backend already validates timezone and rejects invalid values); on success the displayed value SHALL update.
3. THE UI SHALL offer a simple, low-friction picker rather than a free-text field prone to typos — a native `<select>` of common IANA zones with the browser-detected zone preselected/highlighted, plus a one-tap "use my detected timezone" affordance. (A searchable long-list is explicitly not required.)
4. WHEN the backend rejects an invalid timezone THEN the UI SHALL show a friendly error and keep the prior value.

### Requirement 12 — Feedback, accessibility, and consistency

**User Story:** As a user, I want clear feedback and an accessible Settings page, so that I trust and can use it.

#### Acceptance Criteria

1. WHEN any setting is saved THEN the app MAY show a brief confirmation and SHALL keep the control consistent with the server; WHEN a save fails THEN it SHALL revert and show a friendly message with a generic fallback.
2. WHILE a setting save is in flight THE relevant control SHOULD indicate pending state and SHALL avoid duplicate concurrent writes of the same key.
3. THE Settings and Profile pages SHALL be fully keyboard-navigable, use appropriate roles/labels for toggles and selectors, and be responsive down to 320px.
4. Both pages SHALL replace their respective app-shell placeholder routes and integrate with the existing `Header` / `BottomNav` shell.

## Non-Goals

- Spending currency / the customization store (PRD future scope).
- Editing display name, email, avatar, or password (not in the current backend contract; out of scope unless the user requests it).
- Account deletion / data export (PRD open questions / future scope).
- A new backend read endpoint or analytics beyond the four existing ones.
- Reworking the weight algorithm or task API (only surfacing existing `weightBreakdown`).
- Push/email notifications (Phase 2 per PRD).

## Traceability to product docs

- Profile tab = achievements, streaks, analytics, virtual economy: PRD §"Bottom Navigation" (Profile), §Gamification.
- Settings tab = app configuration, project-priority toggle, preferences: PRD §"Bottom Navigation" (Settings).
- Focus Mode (Settings toggle → show only top task): PRD §"Task List View", §Glossary.
- Achievement toasts disable: PRD §"Settings Over Defaults".
- Project Priority global toggle (ON by default, auto-distributed, hidden numbers): PRD §"Project Priority Weighting".
- Weight visibility tiered (free hidden, premium optional toggle + breakdown): PRD §"Weight Visibility (Tiered by User Type)".
- Premium faster earn rate surfaced in economy: PRD §"Virtual Economy".
- Timezone drives local-day streaks/dates: PRD §Glossary + backend user-timezone spec.
- Settings persisted server-side (cross-device SaaS posture): PRD §"Product posture".
