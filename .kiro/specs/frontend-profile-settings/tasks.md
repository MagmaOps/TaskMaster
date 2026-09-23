# Frontend Profile & Settings — Tasks

- [ ] 1. Backend: widen PATCH /api/auth/me to a partial settings body
  - `routes/authRoutes.ts`: replace the timezone-only validator with optional per-key validators — `theme` `isIn(['system','light','dark'])`; `focus_mode_enabled`/`achievement_toasts_enabled`/`project_priority_enabled`/`weight_visibility_enabled` `isBoolean().toBoolean()`; `timezone` existing `custom(isValidTimezone)`.
  - `controllers/authController.ts`: add/rename to `updateSettings` — collect present keys from `req.body`, pass the partial to the service; wire the route.
  - `services/auth/authService.ts`: generalize `updateTimezone` → `updateSettings(userId, patch)` — merge `{ ...user.settings, ...patch }`, resolve `timezone` defensively, **strip `weight_visibility_enabled` when `user.tier !== 'premium'`**, persist via `userRepository.updateSettings`, return `toPublicUser`.
  - _Requirements: 6.1, 6.5, 7.2, 8.2, 9.1, 9.3, 10.2, 11.2_

- [ ] 2. Backend: tests for the widened settings PATCH
  - `routes/authRoutes.test.ts`: partial boolean toggle persists + returns updated user; theme enum validation (invalid → 400); timezone-only still works (backward-compat); invalid timezone → 400; free-tier `weight_visibility_enabled` stripped/ignored; premium can set it.
  - Run backend `npm test` + `npm run typecheck` green.
  - _Requirements: 6.1, 6.5, 10.2, 11.2, 11.4_

- [ ] 3. Frontend: API wrappers + shared types
  - `api/types.ts`: add `AchievementRow`, `StreakState`, `StreakSeriesEntry`, `UserStreaks`, `Economy`, `ProjectAnalytics`, `SettingsPatch`.
  - `api/profile.ts`: `getAchievements`, `getStreaks`, `getEconomy`, `getProjectAnalytics` (unwrap + normalizeError).
  - `api/settings.ts`: `updateSettings(patch) -> User` over `PATCH /auth/me`.
  - _Requirements: 1.1, 6.1_

- [ ] 4. Frontend: settings sync hook (Option A) + tests
  - `hooks/useSettingsSync.ts`: adopt `user.settings.theme` into `useSettings().setTheme` when it differs; `updateSetting(key,value)` = optimistic theme apply → `settingsApi.updateSettings({[key]:value})` → `auth.refreshProfile()`; on failure revert theme + rethrow.
  - Mount in `AppShell.tsx` (authenticated-only) so server theme is adopted.
  - Tests: updateSetting PATCHes + refreshProfile; failure reverts theme + rethrows; server theme adopted when user loads.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.2, 7.3_

- [ ] 5. Frontend: achievement catalog + timezones util
  - `utils/achievementCatalog.ts`: ordered defined list with `{ type, title, description }` for the 11 types (`first_task_completed`, `daily_streak_7|14|30|90`, `repeatable_streak_7|30|100`, `accountable_procrastination`, `high_weight_completed`, `productivity_burst_10`); humanized-slug fallback helper for unknown types.
  - `utils/timezones.ts`: curated common IANA zone list + reuse `detectTimezone()`.
  - _Requirements: 2.2, 2.3, 11.3_

- [ ] 6. Frontend: Profile panels (Streaks, Economy, Achievements, Analytics)
  - `components/profile/StreaksPanel.tsx`: daily current/longest (null → zero state); per-series list (empty → brief note).
  - `components/profile/EconomyPanel.tsx`: balance labeled; premium earn-rate note (never a penalty).
  - `components/profile/AchievementsGallery.tsx`: merge unlocked with catalog → unlocked (title/desc/friendly date) vs greyed locked (no date); unknown unlocked → slug fallback; empty state; locked/unlocked conveyed non-visually.
  - `components/profile/ProjectAnalyticsPanel.tsx`: per-project swatch/name/count/weight/last-date (or "no completions yet"); empty state; label weight as historical.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 7. Frontend: Profile page + routing
  - `pages/Profile.tsx`: four independent async loads, each panel renders its own loading/error-retry/empty; section order Streaks → Economy → Achievements → Analytics; read-only; responsive to 320px.
  - Edit `App.tsx`: Profile route → `<Profile/>`.
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 12.3, 12.4_

- [ ] 8. Frontend: Settings controls (ToggleRow, ThemeSelect, TimezoneSelect)
  - `components/settings/ToggleRow.tsx`: `role="switch"`, aria-checked, keyboard; pending state; guards duplicate concurrent writes.
  - `components/settings/ThemeSelect.tsx`: light/dark/system; applies immediately + persists.
  - `components/settings/TimezoneSelect.tsx`: native `<select>` of common zones (prepend stored zone if absent) + "Use my detected timezone"; persist on change; invalid → revert + friendly error.
  - _Requirements: 7.1, 7.2, 7.3, 11.1, 11.2, 11.3, 11.4, 12.2_

- [ ] 9. Frontend: Settings page + routing
  - `pages/Settings.tsx`: rows for theme, Focus Mode, achievement toasts, project priority (+ helper text), timezone; weight-visibility row only when `tier === 'premium'` (else hidden with brief Premium note). Each uses `useSettingsSync().updateSetting`; success keeps control in sync; failure reverts + toasts.
  - Edit `App.tsx`: Settings route → `<Settings/>`.
  - _Requirements: 8.1, 9.1, 9.3, 10.1, 10.2, 12.1, 12.3, 12.4_

- [ ] 10. Frontend: wire Focus Mode default into task views
  - `pages/TaskList.tsx` (or `TaskProvider` init): seed initial `selection` to `{ kind: 'focus' }` when `user.settings.focus_mode_enabled`, else `{ kind: 'all' }`; applied once on load so the manual pill can still override for the session.
  - _Requirements: 8.1, 8.3, 8.4_

- [ ] 11. Frontend: weight visibility on TaskCard + breakdown popup
  - `components/tasks/WeightBreakdownModal.tsx`: Modal listing `weightBreakdown` line items (base, dueProximity, project, deferral, repeatable, total).
  - `components/tasks/TaskCard.tsx`: add `showWeight?: boolean`; when true render weight + ⓘ button (aria-label, stopPropagation so it doesn't fire `onSelect`) opening the modal.
  - `pages/TaskList.tsx`: pass `showWeight = user.tier === 'premium' && user.settings.weight_visibility_enabled`.
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 12. Frontend: tests for settings + profile + task wiring
  - Settings page: renders from `user.settings`; toggling calls updateSetting; free hides / premium shows weight-visibility; failed PATCH reverts + toasts.
  - Controls: ThemeSelect/TimezoneSelect/ToggleRow reflect value + persist; invalid timezone reverts; pending blocks re-entry.
  - Profile panels: data/loading/error-retry/empty independently; achievements unlocked+greyed+slug fallback; streaks zero-state; analytics "no completions yet".
  - api/profile + api/settings: unwrap + normalized error.
  - TaskCard weight: hidden for free/disabled; ⓘ shown + opens modal + doesn't trigger onSelect when `showWeight`.
  - TaskList focus default: setting true → only top task; false → full list.
  - _Requirements: 1.2, 2.3, 3.1, 5.2, 8.3, 10.1, 10.2, 10.3, 12.1, 12.2_

- [ ] 13. Finalize verification
  - Backend: `npm test` + `npm run typecheck` green.
  - Frontend: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` all green (bundle within budget).
  - Manual smoke against live backend: toggle each setting (verify persists across reload), switch theme (incl. system), change timezone, confirm free vs premium weight-visibility gating, Focus-Mode default view, and the ⓘ weight-breakdown popup for a premium user. Clean up smoke data.
  - _Requirements: all_
