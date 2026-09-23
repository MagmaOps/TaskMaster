# Frontend Profile & Settings — Design

## Overview

Builds the two remaining bottom-nav destinations (Profile, Settings) inside the existing app shell, plus one small backend change so preferences other than `timezone` can be persisted.

- **Profile** — read-only dashboard: achievements gallery (unlocked + greyed locked), streaks (daily + per-series), economy balance, per-project analytics. Four independent read fetches, each with its own loading/error state.
- **Settings** — editors for `user.settings`: theme, Focus Mode, achievement toasts, project priority, timezone, and premium-only weight visibility. Each edit does a partial `PATCH /api/auth/me`, then refreshes the auth profile so all consumers see the change.

Same layering as prior specs: **api wrappers → context/hook → page/components**. `user.settings` (in `AuthContext`) is the single source of truth for preferences; the server owns weight/order/counts, so Profile never writes and Settings writes only settings.

## Backend change (approved: laconic scope)

Widen the existing `PATCH /api/auth/me` from timezone-only to a partial settings body. Three files, no new route, no migration:

- **`routes/authRoutes.ts`** — replace the single timezone validator with optional validators for each settings key:
  - `theme` optional, `isIn(['system','light','dark'])`
  - `focus_mode_enabled`, `achievement_toasts_enabled`, `project_priority_enabled`, `weight_visibility_enabled` optional, `isBoolean().toBoolean()`
  - `timezone` optional, existing `custom(isValidTimezone)`
- **`controllers/authController.ts`** — rename intent from `updateTimezone` to `updateSettings`: read whichever keys are present from `req.body`, pass the partial to the service. (Keep the export name or add `updateSettings`; wire the route to it.)
- **`services/auth/authService.ts`** — generalize `updateTimezone(userId, tz)` into `updateSettings(userId, patch)`: load user, build `next = { ...user.settings, ...sanitizedPatch }`, still resolve `timezone` defensively via `resolveTimezone`, **drop `weight_visibility_enabled` from the patch when `user.tier !== 'premium'`** (server-side gate, defense in depth), persist via `userRepository.updateSettings`, return `toPublicUser`.

Behavior preserved: passing only `{ timezone }` behaves exactly as today. Unspecified keys are untouched (merge, not replace). Invalid values are rejected by the validator (400 `VALIDATION_ERROR`).

Backend tests to add (authRoutes.test.ts): partial patch of a boolean toggle persists + returns updated user; theme enum validation; free-tier `weight_visibility_enabled` is ignored/stripped; timezone-only still works; invalid theme/timezone → 400.

## Files added (frontend)

```
src/
├── api/
│   ├── profile.ts                # getAchievements/getStreaks/getEconomy/getProjectAnalytics wrappers
│   └── settings.ts               # updateSettings(patch) wrapper over PATCH /auth/me
├── hooks/
│   └── useSettingsSync.ts        # authenticated-scoped: adopt server theme + updateSetting(key,value)
├── contexts/
│   └── SettingsContext.tsx       # unchanged holder (localStorage seed + setTheme); see Option A
├── pages/
│   ├── Profile.tsx               # replaces the Profile placeholder route
│   └── Settings.tsx              # replaces the Settings placeholder route
├── components/
│   ├── tasks/
│   │   └── WeightBreakdownModal.tsx # popup opened from the TaskCard ⓘ icon (premium)
│   ├── profile/
│   │   ├── AchievementsGallery.tsx  # unlocked + greyed locked grid
│   │   ├── StreaksPanel.tsx         # daily + per-series
│   │   ├── EconomyPanel.tsx         # balance (+ premium earn-rate note)
│   │   ├── ProjectAnalyticsPanel.tsx# per-project completed count/weight/last date
│   │   └── *.css
│   └── settings/
│       ├── ToggleRow.tsx            # reusable labeled switch with pending/revert
│       ├── ThemeSelect.tsx          # light/dark/system
│       ├── TimezoneSelect.tsx       # native <select> of common zones + "detect"
│       └── *.css
├── utils/
│   ├── achievementCatalog.ts     # type slug -> { title, description }; ordered defined list
│   └── timezones.ts              # curated common IANA list + detect helper
```

Plus edits:
- `src/App.tsx` — Profile/Settings routes render the real pages.
- `src/api/types.ts` — add `AchievementRow`, `StreakState`, `StreakSeriesEntry`, `UserStreaks`, `Economy`, `ProjectAnalytics`, and `SettingsPatch` types (mirror backend).
- `src/components/layout/AppShell.tsx` — mount the authenticated `useSettingsSync()` so server theme is adopted (Option A; ThemeProvider + SettingsContext themselves unchanged).
- `src/pages/TaskList.tsx` — apply the Focus Mode setting as the default selection.
- `src/components/tasks/TaskCard.tsx` — reveal weight + breakdown when premium & enabled.

## API wrappers

### `api/profile.ts` (new)
Typed, unwrapped, throwing `ApiError` (matches `api/auth.ts` pattern):
- `getAchievements() -> AchievementRow[]`
- `getStreaks() -> UserStreaks`
- `getEconomy() -> Economy`
- `getProjectAnalytics() -> ProjectAnalytics[]`

### `api/settings.ts` (new)
- `updateSettings(patch: SettingsPatch) -> User` — `PATCH /auth/me` with the partial body, returns the updated user.

`SettingsPatch = Partial<Pick<UserSettings, 'theme' | 'focus_mode_enabled' | 'achievement_toasts_enabled' | 'project_priority_enabled' | 'weight_visibility_enabled' | 'timezone'>>`.

New `api/types.ts` shapes (mirror backend source):
```ts
interface AchievementRow { id: string; type: string; unlocked_at: string; data: Record<string, unknown>; }
interface StreakState { current: number; longest: number; lastCompletedDate: string | null; }
interface StreakSeriesEntry extends StreakState { seriesId: string; label: string; }
interface UserStreaks { daily: StreakState | null; series: StreakSeriesEntry[]; }
interface Economy { balance: number; earnRate: number; tier: UserTier; }
interface ProjectAnalytics { projectId: string; name: string; priorityOrder: number; color: string | null; tasksCompleted: number; weightCompleted: number; lastCompletionDate: string | null; }
```

## Profile page (`pages/Profile.tsx`)

- No dedicated context; the page owns four independent async loads (a small `useAsync`-style pattern or four `useState` triples). Each of the four panels renders its own loading/error/empty independently (Req 1.2) — one failing fetch never blanks the page.
- Sections in order: Streaks, Economy, Achievements, Project Analytics (order is a UX choice, not load-dependent).
- Read-only; responsive to 320px; each panel is a self-contained component fed its own `{ data, status, error, retry }`.

### AchievementsGallery
- Merges the unlocked rows with the defined catalog: for each catalog entry, find a matching unlocked row (by `type`; streak/series types match on the exact slug) → render unlocked (title, description, friendly `unlocked_at` date) else greyed locked (no date). Unlocked types **not** in the catalog render as an extra unlocked item with a humanized-slug fallback title (forward-compat).
- Locked/unlocked state conveyed non-visually (e.g. `aria-label` "Locked: …" / "Unlocked on …", not color alone) (Req 2.5).
- Empty (nothing unlocked) → encouraging note above the locked grid.

### StreaksPanel
- Daily: `data.daily?.current ?? 0` current, `?.longest ?? 0` longest; null → zero state, not error (Req 3.1).
- Series: list `data.series` in order; each shows `label`, current, longest. Empty series → omit/brief note.

### EconomyPanel
- Show `balance` labeled as earned currency. If `tier === 'premium'`, a subtle "earning faster" note using `earnRate`; never framed as a free-tier penalty (Req 4.2). Read-only.

### ProjectAnalyticsPanel
- One row per `ProjectAnalytics` in returned order: color swatch (when set), name, completed count, total completed weight, last completion date (friendly) or "no completions yet" when null.
- Label `weightCompleted` as a historical/lifetime completion metric, distinct from the hidden live-weight algorithm (Req 5.5). All tiers see it here.
- Empty (only Unassigned, no completions) → encouraging empty state.

## Settings page (`pages/Settings.tsx`)

- Reads `user` from `AuthContext`; if `user` is null (shouldn't happen behind `ProtectedRoute`) render nothing/spinner.
- Renders a vertical list of setting rows using `ToggleRow` / `ThemeSelect` / `TimezoneSelect`.
- Rows:
  1. **Theme** — `ThemeSelect` (light/dark/system).
  2. **Focus Mode** — `ToggleRow` bound to `focus_mode_enabled`.
  3. **Achievement toasts** — `ToggleRow` bound to `achievement_toasts_enabled`.
  4. **Project priority** — `ToggleRow` bound to `project_priority_enabled` + short helper text ("influences task ordering").
  5. **Timezone** — `TimezoneSelect`.
  6. **Weight visibility** — only when `user.tier === 'premium'`; otherwise hidden with a brief "Premium" note (Req 10.2).
- Persistence flow (shared): call `updateSetting(key, value)` from the authenticated `useSettingsSync()` hook (Option A); on success the auth profile is refreshed so `user.settings` updates and controls re-render from server truth; on failure the control reverts and a friendly toast shows (Req 12.1).

### ToggleRow
Reusable labeled switch (`role="switch"`, `aria-checked`, keyboard toggle). Props: `label`, `description?`, `checked`, `onChange(next)`, `pending`, `disabled`. Shows pending state while the PATCH is in flight; guards against duplicate concurrent writes of the same key (Req 12.2).

### ThemeSelect
Segmented control / native `<select>` of light/dark/system. On change: apply immediately via `SettingsContext.setTheme` (existing local mechanism) AND persist `{ theme }`. `system` still follows OS live (ThemeProvider unchanged).

### TimezoneSelect
Native `<select>` of a curated common-zone list from `utils/timezones.ts`, current value preselected; if the stored zone isn't in the curated list, prepend it so it's selectable. A "Use my detected timezone" button sets it to `detectTimezone()`. On change: persist `{ timezone }`; backend validates (invalid → revert + friendly error). Deliberately simple — no searchable long-list (Req 11.3).

## Settings sync (`hooks/useSettingsSync.ts`, new — Option A)

Today `SettingsContext` holds only `theme` from `localStorage`, disconnected from `user.settings`, and sits above `AuthProvider` (so it can't read the user). Rather than reorder providers, the reconciliation lives in an authenticated-scoped hook mounted below `AuthProvider` (in `AppShell` / used by the Settings page). `SettingsContext` itself is unchanged (localStorage seed + `setTheme`).

`useSettingsSync()`:

- Keeps the `localStorage` `tm_theme` value as the pre-auth / anti-flash default (index.html pre-paint script + unauthenticated screens still use it — **no regression** to the flash guard).
- Adopt effect: when `useAuth().user` is available, if `user.settings.theme` differs from `useSettings().theme`, call `setTheme(user.settings.theme)` (server wins for authenticated users); `SettingsContext.setTheme` already mirrors to `localStorage`, so the next pre-paint is correct.
- Exposes `updateSetting(key, value)`:
  1. optimistic: for `theme`, `setTheme(value)` immediately (snappy); for others, no local mirror needed.
  2. `await settingsApi.updateSettings({ [key]: value })`.
  3. on success `await auth.refreshProfile()` (updates `user.settings` → all consumers).
  4. on failure: revert local theme if it was optimistically changed, rethrow so the page toasts.
**Provider-order constraint (verified from `main.tsx`).** The current order is `ErrorBoundary > SettingsProvider > ThemeProvider > ToastProvider > AuthProvider > BrowserRouter > App`. So **`SettingsProvider` sits ABOVE `AuthProvider`** and cannot call `useAuth()` directly. `SettingsProvider` also intentionally wraps `ThemeProvider`, which must stay high (theme applies before auth resolves, and to unauthenticated screens). Two ways to reconcile, pick during implementation:

- **Option A (preferred): keep the tree, push the reconciliation down.** Leave `SettingsContext` as the low-level theme holder (localStorage seed + `setTheme`), and do the *server* reconciliation from an authenticated-only consumer instead of inside `SettingsProvider`. Concretely: a small `useSettingsSync()` hook or effect mounted inside `AppShell` (which is already authenticated-only and below `AuthProvider`) that (1) adopts `user.settings.theme` into `useSettings().setTheme` when it differs, and (2) exposes `updateSetting(key, value)` that PATCHes then `refreshProfile()`. The Settings page uses this hook. This keeps the provider tree untouched and honours the anti-flash seed.
- **Option B: reorder providers** so `AuthProvider` wraps `SettingsProvider`. Riskier — `ThemeProvider` (and its anti-flash contract) would move below auth, and unauthenticated screens still need theme. Avoid unless Option A proves awkward.

Design proceeds on **Option A**: `updateSetting` and the theme-adopt effect live in an authenticated-scoped hook (in `AppShell`/Settings), not in the top-level `SettingsProvider`.

Consumers unaffected: `ThemeProvider` still reads `useSettings().theme`; the value is just now seeded from the server (via the authenticated sync hook) for authed users.

## Wiring the settings into existing views

### Focus Mode (`pages/TaskList.tsx`)
The task-views selector already supports a manual `'focus'` selection kind. `focus_mode_enabled` is the **default**: when the Tasks view first mounts (or the user hasn't overridden the selector this session), seed `TaskContext.selection` to `{ kind: 'focus' }` when `user.settings.focus_mode_enabled` is true, else `{ kind: 'all' }`. Implementation: an effect in `TaskList` (or `TaskProvider` init) that sets the initial selection from the setting once. The user can still switch views via the selector pills afterward; toggling the setting changes the default on next load. This satisfies "enabled → only top task" (Req 8.3) via the existing `focusMode` render path (`restTasks` hidden when `selection.kind === 'focus'`).

### Achievement toasts
Already consumed in `TaskList.celebrate` (`user.settings.achievement_toasts_enabled === false` → skip). Settings only adds the editor; the flag round-trips via `refreshProfile` (Req 9.1–9.2). No task-view change.

### Project priority
Server owns weight; the flag is stored on the user and read by the backend weight calc. Frontend only provides the editor; effect is visible on the next task-list fetch (Req 9.3). No frontend calc change.

### Weight visibility (`components/tasks/TaskCard.tsx` + `WeightBreakdownModal`)
`TaskCard` currently never shows weight. Add: when `user.tier === 'premium'` AND `user.settings.weight_visibility_enabled`, show `task.weight` on the card next to an **info icon (ⓘ) button**. Clicking the icon opens a small popup — `WeightBreakdownModal` (built on the existing Modal primitive) — listing the `task.weightBreakdown` line items (base, dueProximity, project, deferral, repeatable, total). Data is already on `TaskDTO`; no new endpoint (Req 10.3–10.4).

- Keep `TaskCard` presentational: a `showWeight?: boolean` prop (set by `TaskList` from tier + setting) gates the number + icon; the card renders the icon button and raises an `onShowBreakdown(task)` (or manages its own local modal-open state — prefer local state so `TaskList` isn't cluttered, since the modal is self-contained and reads `task.weightBreakdown`).
- The info button MUST stop click propagation so opening the breakdown does not also trigger the card's `onSelect` (action modal). `aria-label="Show weight breakdown"`, keyboard-activatable, focus-trapped modal, Escape to close.
- When disabled/free, `showWeight` is false → unchanged (weight + icon hidden).

## Friendly error mapping

Reuse the existing pattern: normalized `ApiError.code` → copy. Profile fetch errors → per-section "Couldn't load … — Retry". Settings PATCH: `VALIDATION_ERROR` (e.g. bad timezone) → field-specific friendly message + revert; `NETWORK` → connection message; generic fallback otherwise.

## Key design decisions (for review)

- **DD-1 One settings endpoint, partial PATCH.** Widen `PATCH /auth/me` rather than add per-toggle routes; idempotent merge, timezone path unchanged. Free-tier weight-visibility stripped server-side.
- **DD-2 `user.settings` is the single source of truth; refresh-after-write.** Each toggle PATCHes then `refreshProfile()`, mirroring the "server owns state, re-fetch after mutation" pattern used by Task/Project contexts. No parallel client copy of settings (except theme's localStorage anti-flash seed).
- **DD-3 Theme reconciliation keeps the anti-flash localStorage seed** but lets the authenticated server value win, so theme finally becomes cross-device without a pre-paint flash regression.
- **DD-4 Focus Mode setting = default selection, not a new render path.** Reuses the existing selector's `'focus'` kind; the setting only chooses the initial/default view, so the user's in-session pill choice still works.
- **DD-5 Weight visibility via a `showWeight` prop into `TaskCard` + an info-icon popup.** Driven by tier+setting in `TaskList`; clicking the ⓘ opens a `WeightBreakdownModal` over the `weightBreakdown` already on `TaskDTO`. The icon stops propagation so it doesn't open the action modal. Keeps `TaskCard` presentational and easy to test.
- **DD-6 Locked achievements from a frontend catalog** (11 defined types); unknown unlocked types fall back to a humanized slug (forward-compatible with new backend achievements).
- **DD-7 No Profile context.** Four independent one-shot reads with per-section states; a context would add ceremony without cross-section coordination needs.

## Testing strategy (Vitest + RTL)

Frontend:
1. **api/profile + api/settings** — unwrap `data`; throw normalized `ApiError` on failure (mock adapter).
2. **SettingsContext** — `updateSetting` PATCHes + calls `refreshProfile`; failure reverts theme + rethrows; server theme adopted when user loads; throws outside provider.
3. **Settings page** — renders rows from `user.settings`; toggling a switch calls `updateSetting`; free tier hides weight-visibility, premium shows it; failed PATCH reverts control + toasts.
4. **ThemeSelect / TimezoneSelect / ToggleRow** — reflect current value; onChange persists; invalid timezone → revert; pending disables re-entry.
5. **Profile panels** — each renders data / loading / error-retry / empty independently; AchievementsGallery shows unlocked with date + greyed locked without date + slug fallback; streaks zero-state when daily null; analytics "no completions yet" when null.
6. **TaskCard weight** — hidden for free/disabled; weight number + ⓘ shown when `showWeight`; clicking ⓘ opens `WeightBreakdownModal` (breakdown line items) and does NOT trigger `onSelect`.
7. **TaskList focus default** — `focus_mode_enabled` true → initial selection focus (only top task rendered); false → full list.

Backend (see backend change): partial-patch persistence, theme enum + timezone validation, free-tier weight-visibility strip, timezone-only backward-compat.

## Resolved decisions

1. **Weight-breakdown UX** — RESOLVED: the card shows the weight number + an info (ⓘ) icon; clicking the icon opens the `WeightBreakdownModal` popup (not an inline expand, not the action modal).
2. **Focus Mode** — RESOLVED: the setting controls the *default* view on load; the manual selector pill still overrides for the session (DD-4).
3. **Profile section order** — RESOLVED: Streaks → Economy → Achievements → Analytics.
