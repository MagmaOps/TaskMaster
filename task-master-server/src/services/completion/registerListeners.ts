import { registerCompletionListener } from './completionEvents';
import * as economyService from '../economy/economyService';

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
}
