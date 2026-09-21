/**
 * Timezone_Service — pure, deterministic, no I/O.
 *
 * Turns a stored (possibly missing/invalid) IANA timezone string plus an
 * instant into a validated zone, a local calendar date ('YYYY-MM-DD'), a zoned
 * "now" (a Date whose local getters read the wall-clock components in that
 * zone), and the next calendar date. All timezone math uses the built-in `Intl`
 * API — no runtime npm dependency. An injectable clock (`now?: Date`) keeps the
 * functions deterministic under test.
 */

/** Default timezone applied whenever a stored value is missing or invalid. */
export const DEFAULT_TIMEZONE = 'UTC';

/** Longest timezone identifier we accept before treating input as invalid. */
const MAX_TIMEZONE_LENGTH = 64;

const MS_PER_DAY = 86_400_000;

/**
 * Returns `tz` unchanged when it is a valid IANA identifier accepted by
 * `Intl.DateTimeFormat`; otherwise returns 'UTC'. Validation requires a
 * non-empty string of length <= 64 for which constructing
 * `Intl.DateTimeFormat(undefined, { timeZone: tz })` does not throw. The
 * `RangeError` thrown for unknown zones is caught and coalesced to 'UTC'.
 */
export function resolveTimezone(tz: unknown): string {
  return isValidTimezone(tz) ? (tz as string) : DEFAULT_TIMEZONE;
}

/**
 * Predicate form used by the express-validator custom validator on the
 * explicit-update path. True iff `tz` is a non-empty string, <= 64 chars, and
 * accepted by `Intl.DateTimeFormat` as a `timeZone` option.
 */
export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string') return false;
  if (tz.length === 0 || tz.length > MAX_TIMEZONE_LENGTH) return false;
  try {
    // Throws RangeError for identifiers Intl does not recognise.
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The user's Local_Calendar_Date as 'YYYY-MM-DD' in `tz`, relative to `now`
 * (defaults to the current system instant). Invalid `tz` falls back to UTC.
 * Implemented with `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })`
 * / `formatToParts` so the parts are the wall-clock date in that zone.
 */
export function localCalendarDate(tz: string, now: Date = new Date()): string {
  const zone = resolveTimezone(tz);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const { year, month, day } = readParts(parts);
  return `${year}-${month}-${day}`;
}

/**
 * The user's Zoned_Now: a Date whose local getters
 * (getFullYear/getMonth/getDate/getHours…) yield the wall-clock components
 * (y/m/d/h/m/s) in `tz`. Invalid `tz` falls back to UTC.
 *
 * NOTE: the returned Date's local getters read the zoned wall-clock
 * components, but its getTime()/valueOf() does NOT preserve the original
 * instant (it is shifted by the server-vs-target offset). Do NOT use it for
 * elapsed-time/age math — use the true instant for that. Use it only when you
 * need the zoned wall-clock components (y/m/d/h/m/s).
 */
export function zonedNow(tz: string, now: Date = new Date()): Date {
  const zone = resolveTimezone(tz);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const { year, month, day, hour, minute, second } = readParts(parts);
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    normalizeHour(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * 'YYYY-MM-DD' + exactly one calendar day, computed by UTC-noon math on the
 * parsed y/m/d (DST-safe: noon avoids any transition edge and no zone is
 * applied, so the +24h step always advances exactly one calendar day).
 */
export function nextCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d, 12) + MS_PER_DAY);
  const year = String(next.getUTCFullYear()).padStart(4, '0');
  const month = String(next.getUTCMonth() + 1).padStart(2, '0');
  const day = String(next.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Collect the values of the formatted parts into a keyed record. */
function readParts(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/** `Intl` renders midnight as '24' in some environments; normalise to 0. */
function normalizeHour(hour: string): number {
  const h = Number(hour);
  return h === 24 ? 0 : h;
}
