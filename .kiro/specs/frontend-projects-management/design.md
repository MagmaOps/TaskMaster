# Frontend Projects Management — Design

## Overview

Builds the Projects page inside the app shell: `ProjectContext` data layer, the projects list (Unassigned pinned first + real projects), create/edit/delete modals, and `@dnd-kit` drag-and-drop reorder. Consumes the feature-complete backend project API; no backend changes. Reuses the Modal primitive, Button/Input, and Toast from earlier specs.

Same layering as prior specs: **api wrappers → ProjectContext → page/components**. The server owns `priorityOrder`, so reorder sends the full ordered real-project id list and the client reconciles from the server response.

## Files added

```
src/
├── api/
│   └── projects.ts               # EXTEND: add createProject/updateProject/deleteProject/reorderProjects
├── contexts/
│   └── ProjectContext.tsx        # project state + mutations
├── pages/
│   └── ProjectManagement.tsx     # replaces the Projects Placeholder route
├── components/projects/
│   ├── ProjectList.tsx           # dnd-kit context + sortable list of real projects (+ pinned Unassigned)
│   ├── ProjectRow.tsx            # one row: swatch, name, count, drag handle, edit/delete (sortable item)
│   ├── ProjectFormModal.tsx      # create + edit (shared form)
│   ├── DeleteProjectDialog.tsx   # confirm delete
│   └── *.css
```

Plus edits:
- `src/App.tsx` — Projects route renders `<ProjectManagement/>` instead of the placeholder.
- `src/components/layout/AppShell.tsx` — mount `ProjectProvider` alongside `TaskProvider` (both authenticated-only).
- `package.json` — add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

## API wrappers (`api/projects.ts`, extended)

Currently has `listProjects()`. Add (typed, unwrapped, throwing `ApiError`):
- `createProject({ name, color? }) -> ProjectDTO`
- `updateProject(id, { name?, color? }) -> ProjectDTO`
- `deleteProject(id) -> void`
- `reorderProjects(orderedRealIds: string[]) -> ProjectDTO[]`

New shared types in `api/types.ts`: `CreateProjectInput { name; color?: string | null }`, `UpdateProjectInput { name?; color?: string | null }` (mirror backend).

## ProjectContext (`contexts/ProjectContext.tsx`)

State: `{ projects: ProjectDTO[]; status: 'idle'|'loading'|'ready'|'error'; error: string | null }`.

- `loadProjects()` — fetch and store in server order.
- `createProject` / `updateProject` / `deleteProject` — call wrapper, then re-fetch (server owns order + counts).
- `reorderProjects(orderedRealIds)` — call the reorder wrapper; on success set from the returned list; on failure re-fetch to restore server truth and rethrow so the page can show an error + revert optimistic UI.
- Errors set `status='error'` + `error`; mutations rethrow the normalized error to callers (modals show it).
- `useProjects()` throws outside provider.

Rationale: mirrors TaskContext (DD-1 from task-views) — re-fetch keeps the "server owns priorityOrder + taskCount" invariant honest. Reorder is the one place we optimistically reorder locally for a smooth drag, then reconcile.

## Page (`pages/ProjectManagement.tsx`)

- On mount: `loadProjects()`.
- Splits `projects` into `unassigned = projects.find(isDefault)` and `real = projects.filter(!isDefault)`.
- Header with a "New project" button (disabled with a hint when `real.length >= 20`).
- States: loading → Spinner; error → message + Retry; ready → pinned Unassigned row (no affordances) + `ProjectList` of real projects; empty (no real) → encouraging empty state + create CTA (Unassigned still shown).
- Owns modal state: which modal is open (`create` | `edit:<id>` | `delete:<id>` | none).

## ProjectList + dnd-kit (`components/projects/ProjectList.tsx`)

- Wraps real projects in `<DndContext>` + `<SortableContext>` (vertical list strategy) from `@dnd-kit`.
- Sensors: `PointerSensor` + `KeyboardSensor` (keyboard-accessible reorder, Req 6.4), with `sortableKeyboardCoordinates`.
- Each real project is a `ProjectRow` sortable item keyed by id, with a drag handle (☰) bound to the drag listeners.
- `onDragEnd`: compute the new ordered id array via `arrayMove`; if changed, optimistically set local order (lifted to the page or a local mirror) and call `reorderProjects(newRealIds)`; on failure, revert + toast.
- **Unassigned is rendered OUTSIDE the DndContext**, pinned above — so it can't be dragged and nothing can drop above it (Req 6.2).
- No priority numbers shown (Req 6.6).

**Optimistic order handling:** the page keeps a local `orderedReal` state seeded from context; dnd updates it immediately, then `reorderProjects` reconciles from the server response (or reverts on error). Keeping the optimistic list in the page avoids fighting the context re-fetch mid-drag.

## ProjectRow (`components/projects/ProjectRow.tsx`)

`useSortable({ id })` → applies transform/transition; renders drag handle (☰, `aria-label`), color swatch, name, task count, and Edit / Delete buttons. Real rows only; the Unassigned row is a separate simpler presentational component (or the same component with `isDefault` hiding handle + actions).

## Create / Edit modal (`components/projects/ProjectFormModal.tsx`)

Shared form in the Modal primitive:
- Fields: name (required, 1–255), color (optional). Color via a small preset swatch palette + a native `<input type="color">` / clearable.
- `mode="create"` → `createProject`; `mode="edit"` (seeded from the project) → `updateProject`.
- Client validation: non-empty trimmed name; color matches `#RRGGBB` if set. Maps 409 → "a project with that name already exists"; 400 limit → friendly limit message.
- Dismiss via cancel + Escape; focus trap (from Modal); autofocus name.

## Delete confirmation (`components/projects/DeleteProjectDialog.tsx`)

Modal explaining tasks are kept (return to Unassigned) and only the grouping is removed; confirm → `deleteProject(id)`; friendly error on failure.

## Friendly error mapping

Reuse the pattern from Login/tasks: map `ApiError.code` → copy. `CONFLICT` → duplicate-name message; `VALIDATION_ERROR` with the limit → "You've reached the maximum of 20 projects."; `NETWORK` → connection message; generic fallback otherwise. Because the backend uses `VALIDATION_ERROR` for both the limit and default-protection, the page also guards client-side (no edit/delete/drag affordances on Unassigned; create disabled at 20) so those server errors are rarely hit.

## Key design decisions (for review)

- **DD-1 Re-fetch after create/edit/delete; optimistic only for reorder.** Reorder benefits from immediate visual feedback during drag; everything else re-fetches for correctness (server owns order + counts).
- **DD-2 Unassigned rendered outside DndContext, pinned first**, with no handle/edit/delete — enforces "system-managed" purely in the UI and prevents illegal drops above it, so the backend's default-protection errors are a safety net, not a normal path.
- **DD-3 `ProjectContext` mounted in AppShell** (authenticated-only), alongside `TaskProvider`. The task-views filter currently fetches projects locally; refactoring it to consume `ProjectContext` is optional cleanup (Req 1.6) and out of scope unless trivial.
- **DD-4 Client-side guards mirror server protections** (20-max disables create; Unassigned has no mutating affordances) to avoid surfacing raw server rejections for states we can prevent.
- **DD-5 `@dnd-kit`** added now (deferred from the app-shell spec) — matches the locked tech stack.

## Testing strategy (Vitest + RTL)

1. **ProjectContext** — load stores server order; create/edit/delete re-fetch; reorder sets from response and reverts on failure; error path; throws outside provider (api mocked).
2. **ProjectManagement page** — renders Unassigned first (no affordances) + real projects; empty state CTA; loading + error/retry; "New project" disabled at 20.
3. **ProjectFormModal** — name required; create calls createProject + closes; duplicate-name 409 shows friendly message + preserves values; edit pre-fills and calls updateProject.
4. **DeleteProjectDialog** — confirm calls deleteProject; explains tasks are kept; Unassigned has no delete path.
5. **ProjectList reorder** — simulate dnd `onDragEnd` reordering two rows → calls `reorderProjects` with the new real-id order; Unassigned not draggable. (dnd-kit tested at the handler level rather than simulating pointer physics.)

## Open questions for reviewer

1. ~~Color input scope~~ → RESOLVED (lightweight): preset palette (6–8 swatches) + "No color" for the input; color shown as a swatch in the projects list ONLY. No TaskCard changes.
2. ~~Reorder persistence~~ → RESOLVED: send `PUT /reorder` on every drop.
3. ~~ProjectContext vs task-views local fetch~~ → RESOLVED: leave the task-views filter's local `listProjects()` as-is; unify in a later cleanup.
