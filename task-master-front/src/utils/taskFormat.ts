import { format, parseISO, isValid } from 'date-fns';
import type { Priority } from '../api/types';

const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function priorityLabel(priority: Priority): string {
  return PRIORITY_LABELS[priority];
}

/**
 * Format a task's due date/time for display. `dueDate` is 'YYYY-MM-DD',
 * `dueTime` is 'HH:MM' or 'HH:MM:SS' (or null). Returns null when no due date.
 */
export function formatDue(dueDate: string | null, dueTime: string | null): string | null {
  if (!dueDate) return null;
  const parsed = parseISO(dueDate);
  if (!isValid(parsed)) return dueDate;
  const datePart = format(parsed, 'MMM d');
  if (!dueTime) return datePart;
  const hm = dueTime.slice(0, 5); // HH:MM
  return `${datePart}, ${hm}`;
}
