import { detectTimezone } from './timezone';

/**
 * A curated list of common IANA timezones for the Settings timezone picker.
 * Deliberately short and grouped by region rather than a full ~400-zone list —
 * the goal is a low-friction native <select>, not exhaustive coverage. If a
 * user's stored zone isn't here, the picker prepends it so it stays selectable.
 */
export const COMMON_TIMEZONES: string[] = [
  'UTC',
  // Americas
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  // Europe / Africa
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Warsaw',
  'Europe/Athens',
  'Africa/Johannesburg',
  // Asia / Pacific
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export { detectTimezone };

/**
 * Build the option list for the timezone select: the curated common zones, with
 * the current value prepended (once) when it isn't already in the list, so any
 * stored zone remains selectable without a full IANA dump.
 */
export function timezoneOptions(current: string | null | undefined): string[] {
  if (current && !COMMON_TIMEZONES.includes(current)) {
    return [current, ...COMMON_TIMEZONES];
  }
  return COMMON_TIMEZONES;
}
