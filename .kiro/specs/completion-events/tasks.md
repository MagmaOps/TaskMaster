# Completion Events (Foundational) Implementation Tasks

Foundational infra for all completion-driven features. Complete & verified (72 tests passing across the backend). Tasks marked `*` optional.

- [x] 1. Migration `1000000000003_completion_support`
  - `tasks.weight_at_completion integer` (nullable), `tasks.repeat_series_id uuid` (nullable) + partial index; reversible down; applied to dev

- [x] 2. Dispatcher module (`src/services/completion/completionEvents.ts`)
  - `CompletionEvent` (userId, task, weightAtCompletion, unlocked[]), `UnlockedAchievement`
  - `registerCompletionListener`, `clearCompletionListeners`, `emitTaskCompleted` (ordered, error-isolated, never rethrows)

- [x] 3. Types update
  - TaskRow/TaskWithMeta extended with `weight_at_completion`, `repeat_series_id`

- [x] 4. Repository changes
  - `setCompleted(userId, id, weightAtCompletion)` stores weight in the same UPDATE
  - `create`: repeatable tasks get a fresh standalone `repeat_series_id` via `gen_random_uuid()` in the INSERT (no self-reference); null otherwise

- [x] 5. Refactor taskService.completeTask
  - Removed setCompletionHook/onCompleted/CompletionContext; emits `emitTaskCompleted`; persists weight; returns `unlocked`

- [x] 6. Tests
  - Unit: dispatcher order, error isolation, clear, shared-event unlocked append
  - Integration: listener receives event w/ positive weight + returns unlocked; weight_at_completion persisted; throwing listener still 200; repeatable create sets standalone repeat_series_id (≠ task id); non-repeatable null
  - Existing suite still green (no behavior change)

- [x] 7. Verify — typecheck + full `npm test` green (72 tests, 10 suites)
