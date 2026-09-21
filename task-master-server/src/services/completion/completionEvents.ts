import type { TaskWithMeta } from '../../types/task';

/**
 * Completion-event dispatcher.
 *
 * Replaces the single-owner completion hook: multiple features (economy,
 * streaks, achievements, recurrence, analytics) register listeners here and all
 * are notified when a task is completed. Listeners are isolated — a throwing
 * listener is logged and never blocks the others or the completion itself.
 */

/** Minimal achievement shape a listener may append for the client to celebrate. */
export interface UnlockedAchievement {
  type: string;
  data?: Record<string, unknown>;
}

export interface CompletionEvent {
  userId: string;
  task: TaskWithMeta;
  weightAtCompletion: number;
  /** Achievements listener appends here; returned to the client by task-management. */
  unlocked: UnlockedAchievement[];
  /**
   * Streak values computed by the streak listener for THIS completion, published
   * for later listeners (e.g. achievements) to read without re-querying. Set by
   * the streak listener; requires the streak listener to be registered BEFORE
   * achievements in registerAllListeners.
   */
  streaks?: { daily: number; series?: number };
}

export type CompletionListener = (event: CompletionEvent) => Promise<void>;

const listeners: CompletionListener[] = [];

/** Register a listener invoked (in registration order) on every completion. */
export function registerCompletionListener(fn: CompletionListener): void {
  listeners.push(fn);
}

/** Remove all listeners — used for test isolation. */
export function clearCompletionListeners(): void {
  listeners.length = 0;
}

/**
 * Notify all listeners of a completed task. Runs after the task is persisted as
 * completed; a listener error is caught and logged, never rethrown.
 */
export async function emitTaskCompleted(event: CompletionEvent): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Completion listener error:', err);
    }
  }
}
