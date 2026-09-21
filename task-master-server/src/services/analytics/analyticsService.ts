import * as userRepo from '../../repositories/userRepository';
import * as analyticsRepository from '../../repositories/analyticsRepository';
import { resolveTimezone, localCalendarDate } from '../time/userTime';

/**
 * Analytics service — the read side of project analytics.
 *
 * Owns the timezone boundary for `lastCompletionDate`: it resolves the user's
 * zone once (UTC fallback when unset/invalid or the user row is missing) and
 * converts each project's latest completion INSTANT to that zone's calendar
 * day. Performs no writes (Req 6.1); mirrors the streaks/economy service style.
 */

/** One Project_Analytics_Row for the API/controller (service/API DTO). */
export interface ProjectAnalytics {
  projectId: string;
  name: string;
  priorityOrder: number;
  color: string | null;
  tasksCompleted: number;
  weightCompleted: number;
  lastCompletionDate: string | null; // 'YYYY-MM-DD' in the user's zone, or null
}

/**
 * Read-only project analytics for `userId`: one row per Owned_Project with its
 * completed-task count, summed completion weight, and the user-local calendar
 * day of its latest completion.
 *
 * The user's timezone is resolved once (via `userRepo.findById` +
 * `resolveTimezone`, falling back to UTC when missing/invalid). Each row's
 * `MAX(completed_at)` instant is converted with `localCalendarDate(tz, instant)`
 * — the second argument is that project's own latest completion instant, not
 * "now" — so the date is the user-zone day of the actual completion (Req 2.1,
 * 2.3, 2.4); a null instant maps to `null` (Req 2.2). Order is preserved from
 * the SQL (`priority_order` ascending); no writes occur (Req 6.1).
 */
export async function getProjectAnalytics(
  userId: string,
): Promise<ProjectAnalytics[]> {
  const user = await userRepo.findById(userId);
  const tz = resolveTimezone(user?.settings.timezone);
  const rows = await analyticsRepository.projectCompletionStats(userId);
  return rows.map((r) => ({
    projectId: r.id,
    name: r.name,
    priorityOrder: r.priority_order,
    color: r.color,
    tasksCompleted: r.tasks_completed,
    weightCompleted: r.weight_completed,
    lastCompletionDate: r.last_completed_at
      ? localCalendarDate(tz, r.last_completed_at)
      : null,
  }));
}
