import { registerCompletionListener } from './completionEvents';
import * as economyService from '../economy/economyService';
import * as streakService from '../streaks/streakService';
import * as achievementsService from '../achievements/achievementsService';
import * as recurrenceService from '../tasks/recurrenceService';

/**
 * Registers all completion listeners exactly once per process. Called from
 * createApp; guarded so repeated app creation (e.g. in tests) does not
 * register duplicates.
 *
 * As new completion-driven features land (streaks, achievements, recurrence,
 * analytics), add their listeners here in the desired invocation order.
 */
let registered = false;

export function registerAllListeners(): void {
  if (registered) return;
  registered = true;

  registerCompletionListener(economyService.onTaskCompleted);

  // Streaks must be registered BEFORE achievements: achievements reads
  // event.streaks (the just-updated streak values) which the streak listener
  // populates. Economy order relative to streaks does not matter (independent).
  registerCompletionListener(streakService.onTaskCompleted);

  // Achievements is registered AFTER streaks so event.streaks is populated
  // before achievements evaluates its streak-derived milestones.
  registerCompletionListener(achievementsService.onTaskCompleted);

  // Recurrence is order-independent (reads only event.task + the user's timezone),
  // so its slot does not matter; registered last for tidiness.
  registerCompletionListener(recurrenceService.onTaskCompleted);
}
