/**
 * Detect the browser's IANA timezone (e.g. "Europe/Warsaw").
 * Returns undefined if unavailable or invalid, so callers omit the field and
 * let the backend default to UTC. Auth flows must never fail over timezone.
 */
export function detectTimezone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && typeof tz === 'string' ? tz : undefined;
  } catch {
    return undefined;
  }
}
