# Frontend Task Views / "What's Next?" — Design

## Overview

Builds the task experience inside the existing app shell: `TaskContext` data layer, the Tasks page (prominent top task + weight-sorted list), Quick-Add capture, the tap→Action→Deferral modal flow, task create/modify form, project filter, Focus Mode, and completion celebration toasts. Consumes the feature-complete backend task API; no backend changes.

Layering mirrors the app-shell spec: **api wrappers → context (state) → pages/components**. The server owns weight and ordering, so the client never sorts — it fetches and renders in server order, and re-fetches after mutations to stay correct.

## Files added

```
src/
├── api/
│   ├── tasks.ts              # task endpoint wrappers (list/create/update/complete/defer/archive)
│   └── projects.ts           # GET /api/projects wrapper (read-only, for the filter)
├── contexts/
│   └── TaskContext.tsx       # task state + filter + mutations
├── pages/
│   └── TaskList.tsx          # replaces the Tasks Placeholder route
├── components/tasks/
│   ├── TaskCard.tsx          # one task; `variant="top" | "list"`
│   ├── TopTaskCard.tsx       # "What's Next?" prominent wrapper (or TaskCard variant)
│   ├── TaskForm.tsx          # shared fields for Quick-Add and Modify
│   ├── QuickAddModal.tsx     # create flow
│   ├── ActionModal.tsx       # Complete / Later / Modify / Archive / Delete
│   ├── DeferralModal.tsx     # three "Later" options
│   ├── ProjectSelector.tsx   # All + projects filter
│   └── *.css
├── components/common/
│   └── Modal.tsx             # accessible modal primitive (focus trap, Escape, overlay)
├── utils/
│   ├── taskFormat.ts         # due date/time + priority label formatting (date-fns)
│   └── achievementCopy.ts    # achievement type -> friendly celebration text
```

Plus edits:
- `src/App.tsx` — Tasks route renders `<TaskList/>` instead of the placeholder.
- `src/components/layout/BottomNav.tsx` — the center + button opens Quick-Add (was a disabled placeholder). Requires a way to trigger the modal from the shell (see DD-4).
- `src/main.tsx` — mount `TaskProvider` (and `ProjectFilterProvider` if separate) inside the authenticated tree.

## API wrappers

`api/tasks.ts` (typed, unwrapped, throwing `ApiError` via `normalizeError`):
- `listTasks({ projectId?, includeCompleted? }) -> TaskDTO[]`
- `createTask(input: CreateTaskInput) -> TaskDTO`
- `updateTask(id, input: UpdateTaskInput) -> TaskDTO`
- `completeTask(id) -> TaskDTO & { weightAtCompletion; unlocked: UnlockedAchievement[] }`
- `deferTask(id, option: DeferOption) -> TaskDTO`
- `archiveTask(id) -> void`

`api/projects.ts`: `listProjects() -> ProjectDTO[]`.

New shared types in `api/types.ts`: `TaskDTO`, `TaskProjectRef`, `RepeatPattern`, `DeferOption`, `CreateTaskInput`, `UpdateTaskInput`, `UnlockedAchievement`, `WeightBreakdown`, `ProjectDTO` — mirroring the backend `types/task.ts` / `types/project.ts` exactly.

## TaskContext (`contexts/TaskContext.tsx`)

State: `{ tasks: TaskDTO[]; status: 'idle'|'loading'|'ready'|'error'; error: string | null; filterProjectId: string | null }`.

- `loadTasks()` — fetch with current filter (`include_completed=false`), store in server order.
- `setFilterProjectId(id | null)` — set filter, then `loadTasks()`.
- Mutations call the wrapper then **re-fetch** (`loadTasks`) to get correct weight + order. Re-fetch is the simplest correct approach given the server computes weight; it is cheap for MVP task counts (< 1000). (DD-1)
- Errors set `status='error'` + `error` message; mutations surface the error to the caller (so a modal can display it) and leave the list consistent (a failed mutation does not mutate local state before the server confirms).
- `useTasks()` throws outside `TaskProvider`.

Rationale: optimistic updates are tempting but the weight re-sort makes them error-prone (a completed/deferred task changes the order of *others*). Re-fetch keeps the "server owns weight" invariant honest. (DD-1)

## Projects for the filter

The filter needs the project list but not full project state (CRUD is a later spec). `TaskList` fetches projects once via `listProjects()` into local state (or a tiny `useProjects` read hook). Unassigned is included as a normal option (labeled by name). (DD-2)

## Modal primitive (`components/common/Modal.tsx`)

One accessible modal used by Quick-Add, Action, Deferral, and Modify:
- Renders into a portal at document.body; overlay uses `--color-overlay`.
- `role="dialog"` + `aria-modal="true"` + labelled by its title.
- Focus trap: focus moves into the modal on open, cycles within, and restores to the trigger on close.
- Closes on Escape and overlay click (configurable); close control in the header.
- Body scroll locked while open.

## Tasks page (`pages/TaskList.tsx`)

- On mount: `loadTasks()` + fetch projects.
- Renders `ProjectSelector` (Focus, All, projects), then either:
  - **Focus selected:** only the top task (`TopTaskCard`) of the full active set, rest hidden.
  - **All / a project selected:** `TopTaskCard` for `tasks[0]`, then the remaining `tasks.slice(1)` as list `TaskCard`s.
- Loading → Spinner; error → friendly message + Retry (calls `loadTasks`); empty → encouraging empty state + "Add your first task" CTA that opens Quick-Add.
- Tapping any card opens the `ActionModal` for that task.

## TaskCard

Shows subject, priority badge, due date/time (formatted via `utils/taskFormat.ts` with date-fns), project tags, repeatable indicator. `variant="top"` renders larger with a highlighted background and the "What's Next?" label; `variant="list"` is compact. **No weight number is rendered** (Req 2.4) — `weightBreakdown` is ignored in this spec beyond not leaking it.

## Quick-Add & Modify (`QuickAddModal`, `TaskForm`, `ActionModal → Modify`)

`TaskForm` holds the shared fields: subject (required, autofocus), priority selector (default medium), collapsible optional section (due date, due time, project multi-select, repeatable toggle + pattern editor). It maps UI state to `CreateTaskInput`/`UpdateTaskInput`.

- **Quick-Add:** empty `TaskForm` → `createTask` → close → list reflects new task.
- **Modify:** `TaskForm` pre-filled from the task → `updateTask` → close.
- Repeatable pattern editor: frequency daily|weekly; weekly reveals day-of-week checkboxes (0–6) mapped to `repeatPattern.days_of_week`; optional interval and end_date. Produces the backend `RepeatPattern`.
- Client validation: subject 1–500; date/time format guards mirror backend regexes; friendly server-error fallback preserving entered values.

## Action & Deferral flow

- `ActionModal` lists Complete / Later / Modify / Archive / Delete.
  - Complete → `completeTask` → on success remove from list (via re-fetch) and fire celebration toasts if `unlocked` non-empty.
  - Later → swap to `DeferralModal` (Later Today / Tomorrow / Sometime Later) → `deferTask(option)`.
  - Modify → open `TaskForm` in edit mode.
  - Archive → `archiveTask`; Delete → confirm, then `archiveTask` (backend soft-archives both; Delete just adds a confirm step). (DD-3)
- In-flight controls show pending state and block double submit.

## Celebration toasts (`utils/achievementCopy.ts`)

Maps achievement `type` → friendly copy, e.g. `first_task_completed` → "First one done — you're off! 🎉"; `daily_streak_7` → "7-day streak! 🔥"; unknown types → a generic "Achievement unlocked!". `completeTask`'s `unlocked[]` drives one `showToast` per achievement, **only when** the authenticated user's `settings.achievement_toasts_enabled` is true (read from `useAuth().user`). (Req 7.4)

## Selector, Focus, & settings reads

`ProjectSelector` renders a single-select pill row: **[Focus icon] [All] [Unassigned] [project…] …**. Selection is transient view state held in `TaskContext` as a discriminated value: `{ kind: 'focus' } | { kind: 'all' } | { kind: 'project', id }`. This drives both the fetch (`project_id` only for `kind==='project'`) and the render mode (`focus` → top task only). It is mutually exclusive (one pill active) and resets on logout. (DD-5)

- **Focus pill:** first position, small focus-themed PNG icon (generated placeholder now, real art in the branding pass), `aria-pressed`/selected styling like the other pills, accessible label "Focus — show only your top task".
- Selecting Focus fetches the full active set (no `project_id`) and renders only `tasks[0]`.
- `achievement_toasts_enabled` is still read from `useAuth().user.settings` to gate celebration toasts (Req 7.4).

Note: the persistent `focus_mode_enabled` server setting and its Settings editor remain the profile/settings spec's job; this spec's Focus pill is transient view state, not a persisted setting.

## Key design decisions (for review)

- **DD-1 Re-fetch after mutations** instead of optimistic local edits — preserves the server-owned weight ordering invariant; cheap at MVP scale. Revisit with optimistic UI only if latency is felt.
- **DD-2 Projects read locally in TaskList** (not a full ProjectContext) — the filter needs only the list; full project state lands in the projects-management spec, which can introduce `ProjectContext` and TaskList can switch to it then.
- **DD-3 Archive vs Delete** both hit `DELETE /:id` (soft archive); Delete differs only by a confirm step, matching the backend's single soft-delete semantics. No hard delete exists.
- **DD-4 Opening Quick-Add from the BottomNav + (RESOLVED):** `TaskContext` exposes `isQuickAddOpen`/`openQuickAdd`/`closeQuickAdd`; `QuickAddModal` is mounted once in `TaskList`. The BottomNav center + calls `openQuickAdd()`. Since + is only meaningful where tasks live, when + is pressed on another route the app navigates to `/` (Tasks) and opens Quick-Add there.
- **DD-5 Focus as a selector pill (RESOLVED):** Focus is the first pill in the project selector, single-select and mutually exclusive with All/projects — "All, but only the top task". It is transient view state in TaskContext, reset on logout. `achievement_toasts_enabled` is read from the authed user to gate toasts. The persistent `focus_mode_enabled` setting + Settings editor stay in the profile/settings spec.
- **DD-6 No weight display** for anyone in this spec; premium breakdown UI deferred.
- **DD-7 Priority default medium** in Quick-Add (RESOLVED).
- **DD-8 Swipe-to-defer skipped** (RESOLVED) — tap→Action→Deferral is the only path this spec.

## Testing strategy (Vitest + RTL)

1. **TaskContext** — load populates in server order; filter change refetches with `project_id`; complete/defer/archive trigger refetch and reconcile; error path sets error; `useTasks` throws outside provider (api mocked).
2. **TaskList** — renders top task prominently + rest below; empty state with CTA; loading + error/retry; Focus Mode shows only top task.
3. **QuickAddModal / TaskForm** — subject required + autofocus; optional fields collapsed; repeatable weekly reveals days; valid submit calls createTask + closes; server error preserves values.
4. **ActionModal + DeferralModal** — options present; Complete calls completeTask and fires celebration when unlocked non-empty (and suppressed when toasts disabled); Later→defer sends correct option; Delete confirms; focus trap + Escape.
5. **ProjectSelector** — lists All + projects incl. Unassigned; selecting sets filter/ refetch.
6. **achievementCopy / taskFormat** — mapping + date/time formatting units.

## Open questions for reviewer

All resolved:
1. ~~Quick-Add trigger wiring~~ → DD-4: TaskContext `openQuickAdd`, modal in TaskList, BottomNav + calls it (navigates to Tasks first when elsewhere).
2. ~~Priority default~~ → DD-7: medium.
3. ~~Swipe-to-defer~~ → DD-8: skipped.
4. ~~Focus Mode~~ → DD-5: first pill in the project selector, single-select, transient view state.
