# Completion Events (Foundational) Design

## Overview

Replaces the single `setCompletionHook` with a multi-listener dispatcher, adds two shared task columns, and records `weight_at_completion` at completion. Pure infrastructure; downstream specs (economy, streaks, achievements, task-recurrence, analytics) register listeners.

## The dispatcher (`src/services/completion/completionEvents.ts`)

```ts
export interface CompletionEvent {
  userId: string;
  task: TaskWithMeta;
  weightAtCompletion: number;
  /** Listeners (achievements) may append unlocked achievements for the client. */
  unlocked: UnlockedAchievement[];
}

type CompletionListener = (event: CompletionEvent) => Promise<void>;

const listeners: CompletionListener[] = [];

export function registerCompletionListener(fn: CompletionListener): void { listeners.push(fn); }
export function clearCompletionListeners(): void { listeners.length = 0; } // test isolation

export async function emitTaskCompleted(event: CompletionEvent): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(event);
    } catch (err) {
      console.error('Completion listener error:', err); // never rethrow
    }
  }
}
```

`UnlockedAchievement` is a minimal shared shape (`{ type: string; data?: Record<string, unknown> }`) defined here so task-management can return it without depending on the achievements feature. The achievements spec will produce full rows but map to this shape when appending.

## task-management integration (refactor)

`taskService.completeTask` currently:
1. loads the task, guards 404/409,
2. computes `weightAtCompletion`,
3. `setCompleted`,
4. calls the single `onCompleted` hook,
5. returns DTO + weightAtCompletion.

Changes:
- Remove `setCompletionHook`/`onCompleted`; import `emitTaskCompleted` + `CompletionEvent`.
- After `setCompleted`, also persist `weight_at_completion` (either in the same UPDATE — preferred — or a follow-up UPDATE). Extend `taskRepository.setCompleted` to accept and store the weight: `setCompleted(userId, id, weightAtCompletion)`.
- Build the event `{ userId, task: full, weightAtCompletion, unlocked: [] }`, call `await emitTaskCompleted(event)`.
- Return `{ ...dto, weightAtCompletion, unlocked: event.unlocked }`.

`CompletionContext` (old) is replaced by `CompletionEvent`. The old `setCompletionHook` export is removed; no other code references it yet.

## Schema — migration `1000000000003_completion_support`

```sql
ALTER TABLE tasks ADD COLUMN weight_at_completion integer;      -- set on complete
ALTER TABLE tasks ADD COLUMN repeat_series_id uuid;             -- stable repeatable-series id
CREATE INDEX idx_tasks_repeat_series ON tasks(repeat_series_id) WHERE repeat_series_id IS NOT NULL;
```
Reversible `down` drops both. Applied to dev; test DB re-migrates via globalSetup.

### Setting repeat_series_id on create
In `taskRepository.create`, when `is_repeatable` is true, generate a fresh UUID for the series and set `repeat_series_id` to it **in the same INSERT** (`gen_random_uuid()` in SQL, or a `crypto.randomUUID()` passed as a parameter). No self-reference and no follow-up UPDATE. Non-repeatable rows leave it null. Task-recurrence will later copy this value onto regenerated occurrences.

The series id is deliberately independent of any task id: deleting or archiving occurrence rows never affects the series identity that streaks/recurrence rely on.

## Types
- Extend `TaskRow`/`TaskWithMeta` with `weight_at_completion: number | null` and `repeat_series_id: string | null`.
- `UnlockedAchievement` shared type in the completion module (or `src/types`).

## Testing Strategy
- **Unit:** dispatcher — listeners invoked in order; a throwing listener is caught and the next still runs; `clearCompletionListeners` empties the registry.
- **Integration (existing suite):** all current task-management/projects/auth tests still pass after the refactor. Add a focused test: register a temporary listener, complete a task, assert the listener received the event with a positive `weightAtCompletion`; register a throwing listener and assert completion still returns 200.
- **DB:** after completing a task, `tasks.weight_at_completion` is populated; creating a repeatable task sets a non-null `repeat_series_id` that does not equal the task's own id; a non-repeatable task leaves it null.
- Tests call `clearCompletionListeners()` in setup to avoid cross-test leakage.
