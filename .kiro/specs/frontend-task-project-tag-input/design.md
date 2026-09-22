# Frontend Task Project Tag-Input — Design

## Overview

Replaces the project checkbox list in `TaskForm` with a badge/tag input featuring case-insensitive autocomplete over existing projects and inline creation of new projects on task save. New projects get a random palette color chosen on the frontend. Contained to the task form's project field; consumes existing backend endpoints only.

Builds on the already-landed companion fix (TaskForm seeds `projectIds` from real projects only, never the Unassigned default).

## Files

```
src/
├── components/tasks/
│   ├── ProjectTagInput.tsx      # NEW: the badge + autocomplete input
│   ├── ProjectTagInput.css      # NEW
│   └── TaskForm.tsx             # EDIT: swap checkbox list -> ProjectTagInput; save flow creates pending projects
├── utils/
│   └── projectColor.ts          # NEW: shared PALETTE + randomPaletteColor()
└── components/projects/
    └── ProjectFormModal.tsx     # EDIT (tiny): import PALETTE from utils/projectColor (single source)
```

No new context. The task form already receives `projects: ProjectDTO[]` (loaded by TaskList) and calls `createProject` indirectly via a new prop (see below).

## Shared palette (`utils/projectColor.ts`)

Extract the 8-swatch palette (currently inline in `ProjectFormModal`) into `PALETTE: string[]` and add `randomPaletteColor(): string`. `ProjectFormModal` imports `PALETTE` from here (single source of truth). `ProjectTagInput`/save flow uses `randomPaletteColor()` for new projects.

## Data model in the form

`TaskForm` tracks selected projects as a list of "chips" rather than a bare id array:

```ts
type Chip =
  | { kind: 'existing'; id: string; name: string; color: string | null }
  | { kind: 'pending'; name: string }; // created on save
```

- Modify mode seeds `existing` chips from `initialTask.projects` filtered to real projects (reusing the fixed logic; cross-referenced against `projects` to drop the default).
- On submit, `pending` chips are created first (below), then all chip ids form `projectIds`.

## ProjectTagInput component

Props:
```ts
{
  projects: ProjectDTO[];        // all projects (real + default); default excluded internally
  value: Chip[];                 // current chips
  onChange: (chips: Chip[]) => void;
  error?: string;                // inline hint (e.g. reserved-name)
}
```

Behavior:
- Renders each chip as a badge: color circle (`● `) when `existing` with a `color`, then the name. Pending chips: name only (no circle).
- A text `<input>` after the badges. Typing filters `realProjects` (exclude `isDefault` and already-chosen) case-insensitively by substring → suggestion listbox.
- **Keyboard:** ArrowUp/Down move the active suggestion; Enter/comma confirm; Backspace-on-empty removes the last chip; Escape closes the list.
- **Confirm logic (`confirmText(raw)`):**
  1. `name = raw.trim()`; if empty → no-op.
  2. If `name.toLowerCase() === 'unassigned'` → set inline error hint, don't add.
  3. If a chip already present matches `name` case-insensitively → clear input, no-op.
  4. Else if an existing real project matches `name` case-insensitively → add an `existing` chip (real id + color).
  5. Else → add a `pending` chip with `name`.
  Then clear the input + error.
- Clicking a suggestion == confirming that existing project.
- ARIA: input is a combobox controlling a listbox of suggestions; `aria-activedescendant` for the active option; badges are labelled; the whole control is keyboard reachable with visible focus.

Comma handling: intercept `,` on keydown (and strip a trailing comma if pasted) → treat as confirm. Names therefore can't contain commas (documented non-goal).

## TaskForm changes

- Replace the `assignable.map(checkbox)` block with `<ProjectTagInput projects={projects} value={chips} onChange={setChips} error={projectHint} />`.
- Keep the field inside the collapsible "More options" section (unchanged placement).
- **Submit flow** (new `resolveProjectIds` step before calling `onSubmit`):
  1. Split chips into `existing` (have ids) and `pending` (names).
  2. For each pending name, call the injected `createProject({ name, color: randomPaletteColor() })`.
     - On success → collect the new id.
     - On 409 `CONFLICT` → reconcile: re-fetch projects (or match against a provided lookup) by case-insensitive name and use that id; if still not found, surface a friendly error.
     - On other error (400 limit / network) → abort submit, show friendly message, preserve chips.
  3. `projectIds = [...existingIds, ...createdIds]` (all real).
  4. Call the existing `onSubmit({ ...taskInput, projectIds })`.
- Because pending-project creation needs `createProject` and reconciliation needs the latest list, `TaskForm` gains two props from its parents: `createProject: (input) => Promise<ProjectDTO>` and `listProjects: () => Promise<ProjectDTO[]>` (or a `reconcileProjectByName` helper). These come from `ProjectContext` at the call sites (QuickAddModal / ActionModal are rendered by TaskList/ActionModal which can pull from `useProjects`).

## Wiring the dependencies

- `TaskList` already loads projects locally (task-views DD). For this spec, the task form needs `createProject` + a way to reconcile. Simplest: have `TaskList` and `ActionModal`'s hosts consume `useProjects()` (ProjectContext now exists and is mounted in AppShell) to pass `createProject` and the current `projects` down to `TaskForm`.
  - This is a light, sanctioned use of `ProjectContext` (the projects-management spec left the task-views local fetch as-is, but adding create capability here is the natural point to pull it from context).
  - After a successful create, calling `ProjectContext.createProject` also refreshes the shared project list, so the Tasks filter and Projects page stay consistent.

## Error/friendly mapping

Reuse the existing `ApiError.code` mapping: `CONFLICT` handled by reconcile (not shown as an error unless reconcile fails), `VALIDATION_ERROR` (limit) → "You've reached the maximum of 20 projects.", `NETWORK` → connection message, generic fallback. Reserved-name is prevented client-side (never reaches the server via this input).

## Key design decisions (for review)

- **DD-1 Chips model (existing | pending)** instead of a bare id array — needed because a pending project has no id until save.
- **DD-2 Create-on-save, not create-on-confirm** — matches "created together with the task"; avoids orphan projects if the user cancels the task. Trade-off: a tiny orchestration step (create projects → then task) with 409 reconciliation.
- **DD-3 Frontend random color** from the shared palette (per your call) — no backend change; user doesn't choose/preview.
- **DD-4 Comma is a confirm key** → project names created via this input can't contain commas (documented non-goal). Enter also confirms.
- **DD-5 Backspace-only removal** (no × button) per your preference.
- **DD-6 Pull `createProject` from `ProjectContext`** at the task-form call sites — the natural, minimal way to get create + list-refresh without duplicating logic.

## Testing strategy (Vitest + RTL)

1. **projectColor util** — `PALETTE` non-empty; `randomPaletteColor()` returns a palette member.
2. **ProjectTagInput** —
   - typing filters case-insensitively ("wo" matches "Work"); already-chosen + default excluded from suggestions;
   - Enter on an existing-name (any case) adds the existing chip (with color circle) not a duplicate;
   - Enter/comma on a new name adds a pending chip (no circle);
   - duplicate name ignored; "Unassigned" rejected with hint;
   - Backspace-on-empty removes the last chip; comma confirms.
3. **TaskForm save flow** —
   - modify Unassigned task submits `projectIds: []` (regression, already covered) and via tag input still never sends the default;
   - a pending chip triggers `createProject({ name, color: <palette> })` then submits task with the new id;
   - 409 on create reconciles to the existing id and still submits;
   - 400 limit aborts submit + shows message + preserves chips.
4. **Integration (light)** — QuickAdd/Modify render the tag input; adding an existing project via suggestion then submitting calls create/update with the right ids.

## Open questions for reviewer

All prior interaction questions resolved (Enter+comma confirm; Backspace-only removal; case-insensitive reuse; reserved-name rejected; random front color). Remaining:
1. **Reconcile source on 409:** re-fetch the full project list and match by name (simple, one extra GET) vs. trusting an in-memory list. I lean re-fetch on conflict only (rare path). OK?
