import * as userRepo from '../../repositories/userRepository';
import * as taskRepo from '../../repositories/taskRepository';
import { resolveTimezone, localCalendarDate } from '../time/userTime';
import { nextDueDate } from './recurrence';
import type { CompletionEvent } from '../completion/completionEvents';

/**
 * Recurrence service — the completion-listener side of task recurrence.
 *
 * On each completion it inspects the completed task and, when that task is a
 * repeatable series whose schedule has not ended, inserts exactly one active
 * Next_Occurrence sharing the same `repeat_series_id` with a freshly computed
 * `due_date` (subject/priority/projects/due_time/pattern copied unchanged).
 *
 * Order-independent: it reads only `event.task` and — on the null-`due_date`
 * fallback path — the user's timezone. It never touches `event.streaks` or
 * `event.unlocked`, so its registration slot on the dispatcher does not matter.
 * It does not throw for expected states (non-repeatable, null pattern/series,
 * missing user, ended schedule); the dispatcher isolates any unexpected throw.
 */

/**
 * Normalize a pg DATE column to a clean 'YYYY-MM-DD' string.
 *
 * `pg` returns a DATE as a string in some paths and a JS `Date` in others.
 * A `Date` is read via its LOCAL getters (never UTC getters, which would shift
 * the day back whenever the server runs ahead of UTC), matching the proven
 * `normalizeDate` helpers in taskService / streakRepository. Strings are sliced
 * to the leading date part; null passes through.
 */
function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = String(value.getFullYear()).padStart(4, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * Completion listener: regenerate the next occurrence of a repeatable series.
 *
 * Reads only `event.task` (plus the user's timezone on the fallback path), so
 * it is safe to register in any order relative to the other listeners.
 */
export async function onTaskCompleted(event: CompletionEvent): Promise<void> {
  const task = event.task;

  // Step 1: nothing to regenerate for a non-repeatable task or one without a
  // pattern; a repeatable task should always carry a series id, but guard anyway.
  if (!task.is_repeatable || task.repeat_pattern == null) return;
  if (task.repeat_series_id == null) return;

  // Step 2: resolve the Anchor_Date (DD-1). Schedule-anchored to the completed
  // occurrence's due date when set; otherwise the user's local completion day
  // (the DB lookup + timezone resolution is skipped entirely in the common case).
  let anchor: string;
  const dueDate = normalizeDate(task.due_date);
  if (dueDate != null) {
    anchor = dueDate;
  } else {
    const user = await userRepo.findById(event.userId);
    const tz = resolveTimezone(user?.settings.timezone);
    anchor = localCalendarDate(tz);
  }

  // Step 3: compute the next due date; null means the schedule has ended.
  const nextDue = nextDueDate(task.repeat_pattern, anchor);
  if (nextDue == null) return;

  // Step 4: insert the next occurrence in the same series, fields copied over.
  await taskRepo.createOccurrence({
    userId: task.user_id,
    subject: task.subject,
    priority: task.priority,
    dueDate: nextDue,
    dueTime: task.due_time,
    repeatPattern: task.repeat_pattern,
    repeatSeriesId: task.repeat_series_id,
    projectIds: task.projects.map((p) => p.id),
  });
}
