import { registerCompletionListener } from './completionEvents';
import * as economyService from '../economy/economyService';
import * as streakService from '../streaks/streakService';

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
  // When the achievements listener lands, add it AFTER this line.
  registerCompletionListener(streakService.onTaskCompleted);
}
