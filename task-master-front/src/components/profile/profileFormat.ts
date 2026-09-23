import { format, parseISO, isValid } from 'date-fns';

/** Load state shared by the independent Profile panels. */
export type AsyncStatus = 'loading' | 'ready' | 'error';

export interface AsyncState<T> {
  data: T | null;
  status: AsyncStatus;
  error: string | null;
  retry: () => void;
}

/** Format a 'YYYY-MM-DD' calendar day for friendly display, e.g. "Sep 20, 2026". */
export function formatDay(day: string | null): string | null {
  if (!day) return null;
  const parsed = parseISO(day);
  return isValid(parsed) ? format(parsed, 'MMM d, yyyy') : day;
}

/** Format an ISO timestamp (achievement unlocked_at) as a friendly date. */
export function formatTimestamp(ts: string): string {
  const parsed = parseISO(ts);
  return isValid(parsed) ? format(parsed, 'MMM d, yyyy') : ts;
}
