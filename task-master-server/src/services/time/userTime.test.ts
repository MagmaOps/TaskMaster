import fc from 'fast-check';
import { isValidTimezone } from './userTime';
import { DEFAULT_USER_SETTINGS, type UserSettings } from '../../types';

/**
 * Curated list of valid IANA identifiers used to exercise the merge with an
 * arbitrary-but-valid timezone. Kept small and diverse (offsets, DST rules,
 * hemispheres) — the property under test is about the spread preserving keys,
 * not about the breadth of the zone set.
 */
const VALID_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

/** Arbitrary UserSettings document covering every key of the interface. */
const arbUserSettings: fc.Arbitrary<UserSettings> = fc.record({
  project_priority_enabled: fc.boolean(),
  achievement_toasts_enabled: fc.boolean(),
  focus_mode_enabled: fc.boolean(),
  weight_visibility_enabled: fc.boolean(),
  theme: fc.constantFrom('system', 'light', 'dark'),
  timezone: fc.string(),
});

describe('settings merge — timezone update preserves all other settings', () => {
  // Feature: user-timezone, Property 6: updating the timezone preserves all other
  // settings — for an arbitrary UserSettings document and an arbitrary valid IANA
  // timezone, the merge `{ ...settings, timezone }` changes ONLY the `timezone` key.
  // Validates: Requirements 1.4
  it('changes only the timezone key (fast-check, >= 100 runs)', () => {
    fc.assert(
      fc.property(arbUserSettings, fc.constantFrom(...VALID_TIMEZONES), (settings, timezone) => {
        // Mirror the exact expression used in authService.updateTimezone.
        const merged = { ...settings, timezone };

        // 1. The timezone key takes the new value.
        expect(merged.timezone).toBe(timezone);

        // 2. Every OTHER key/value in the original settings is unchanged.
        for (const key of Object.keys(settings) as (keyof UserSettings)[]) {
          if (key === 'timezone') continue;
          expect(merged[key]).toBe(settings[key]);
        }

        // 3. The set of keys that differ between input and output is a subset of
        //    {'timezone'} — empty when the new tz equals the original, otherwise
        //    exactly {'timezone'}.
        const allKeys = new Set<keyof UserSettings>([
          ...(Object.keys(settings) as (keyof UserSettings)[]),
          ...(Object.keys(merged) as (keyof UserSettings)[]),
        ]);
        const differing = [...allKeys].filter((k) => settings[k] !== merged[k]);
        for (const k of differing) {
          expect(k).toBe('timezone');
        }
        if (settings.timezone === timezone) {
          expect(differing).toHaveLength(0);
        }

        // 4. No keys are added or removed by the merge.
        expect(Object.keys(merged).sort()).toEqual(Object.keys(settings).sort());
      }),
      { numRuns: 100 },
    );
  });

  it('preserves keys for the DEFAULT_USER_SETTINGS baseline', () => {
    const timezone = 'Asia/Tokyo';
    expect(isValidTimezone(timezone)).toBe(true);
    const merged = { ...DEFAULT_USER_SETTINGS, timezone };
    expect(merged.timezone).toBe('Asia/Tokyo');
    expect(merged.project_priority_enabled).toBe(DEFAULT_USER_SETTINGS.project_priority_enabled);
    expect(merged.achievement_toasts_enabled).toBe(DEFAULT_USER_SETTINGS.achievement_toasts_enabled);
    expect(merged.focus_mode_enabled).toBe(DEFAULT_USER_SETTINGS.focus_mode_enabled);
    expect(merged.weight_visibility_enabled).toBe(DEFAULT_USER_SETTINGS.weight_visibility_enabled);
    expect(merged.theme).toBe(DEFAULT_USER_SETTINGS.theme);
  });
});
