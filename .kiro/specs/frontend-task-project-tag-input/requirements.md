# Frontend Task Project Tag-Input (with inline create) — Requirements

## Introduction

A focused enhancement to the task form (Quick-Add + Modify) delivered by the task-views spec. It replaces the project **checkbox list** with a **tag/badge input** that supports case-insensitive autocomplete over existing projects and **inline creation** of new projects while adding or modifying a task. It also fixes the interaction so a task's project assignment can be changed on Modify without error.

Context: a companion bug fix already landed — `TaskForm` no longer seeds `projectIds` with the Unassigned default id, so modifying an Unassigned task succeeds. This spec builds the richer input on top of that corrected behavior.

The backend project/task APIs are unchanged (no backend work). New projects are created via the existing `POST /api/projects`; the task is saved via the existing task create/update.

### Backend contract consumed (confirmed)

- `GET /api/projects` → `ProjectDTO[]` (`{ id, name, priorityOrder, isDefault, color, taskCount, createdAt }`), Unassigned first (`isDefault: true`).
- `POST /api/projects` → `{ success, data: ProjectDTO }` (201). Body `{ name (1–255), color? (#RRGGBB) }`. Errors: 409 `CONFLICT` on duplicate name (case-insensitive) or the reserved name "unassigned"; 400 `VALIDATION_ERROR` at the 20-project max.
- Task create/update send `projectIds` (uuids of **real** projects only; the default id must never be sent).

## Glossary

- **Tag input:** the badge-based multi-select that replaces the project checkbox list in the task form.
- **Badge:** a selected project shown as a chip; `● Name` with a color circle when the project has a `color`.
- **Existing badge:** a badge backed by a real project that already has an id.
- **Pending badge:** a typed name with no matching project yet; created on task save.
- **Confirm key:** Enter or comma — turns the current input text into a badge.

## Requirements

### Requirement 1 — Tag input replaces the checkbox list

**User Story:** As a user, I want to manage a task's projects with a fast tag input, so that assigning projects feels quick and modern.

#### Acceptance Criteria

1. THE task form (Quick-Add and Modify) SHALL present project selection as a tag input containing zero or more badges plus a text field, replacing the previous checkbox list.
2. THE tag input SHALL only ever represent **real** projects; it SHALL NOT show or allow selecting the Unassigned default (assignment to Unassigned remains automatic server-side).
3. WHEN the form is in Modify mode THEN the input SHALL be pre-populated with the task's currently assigned **real** projects as existing badges (never the default), consistent with the companion bug fix.
4. EACH badge SHALL display the project name; IF the project has a `color` THEN the badge SHALL show a filled color circle before the name (`● Name`); pending badges (not yet created) SHALL show no circle.

### Requirement 2 — Case-insensitive autocomplete

**User Story:** As a user, I want typing to suggest my existing projects regardless of case, so that I reuse projects instead of duplicating them.

#### Acceptance Criteria

1. WHILE the user types in the input THE app SHALL show a suggestion list of existing real projects whose names contain the typed text, matched **case-insensitively**.
2. THE suggestions SHALL exclude projects already added as badges and SHALL exclude the Unassigned default.
3. Project names MAY contain spaces and normal punctuation; matching SHALL operate on the raw text (spaces allowed), not word tokens.
4. WHEN a suggestion is chosen (click or keyboard select) THEN it SHALL be added as an existing badge and the input SHALL clear.
5. WHEN there are no matching suggestions THE list MAY show a hint that pressing Enter/comma will create a new project with the typed name.

### Requirement 3 — Confirm, create-on-save, and matching

**User Story:** As a user, I want to press Enter (or comma) to confirm a project — creating it if it doesn't exist — so that I never have to leave the task form.

#### Acceptance Criteria

1. WHEN the user presses **Enter or comma** with non-empty input THEN the app SHALL confirm the current text into a badge.
2. IF the typed text matches an existing real project **case-insensitively** THEN the app SHALL add that **existing** project (its real id/color), NOT create a duplicate.
3. IF the text matches no existing project THEN the app SHALL add a **pending badge** with the trimmed typed name; the project SHALL be created only when the task is saved.
4. IF the typed text (trimmed, case-insensitive) equals a badge already present THEN the app SHALL ignore it (no duplicate badge) and clear the input.
5. IF the typed text (trimmed, case-insensitive) equals the reserved name "unassigned" THEN the app SHALL reject it inline with a small hint and SHALL NOT add a badge.
6. THE confirm SHALL trim surrounding whitespace; empty/whitespace-only input SHALL not create a badge.
7. A trailing comma typed inside a longer name SHALL act as a confirm delimiter (comma is a confirm key, so project names entered via this input cannot contain commas — acceptable for MVP).

### Requirement 4 — Remove via Backspace

**User Story:** As a user, I want to remove the last project with Backspace, so that editing is keyboard-fast without extra buttons.

#### Acceptance Criteria

1. WHEN the input text is empty AND the user presses Backspace THEN the app SHALL remove the most recently added badge.
2. THERE SHALL be no per-badge "×" button; Backspace-on-empty is the only removal affordance.
3. Removing a pending badge SHALL simply drop it (nothing was created yet); removing an existing badge SHALL only unassign it from the task on save (the project itself is not deleted).

### Requirement 5 — Save flow (create pending projects, then save task)

**User Story:** As a user, I want new projects to be created and assigned when I save the task, so that it all happens in one action.

#### Acceptance Criteria

1. WHEN the task form is submitted THEN for each **pending** badge the app SHALL `POST /api/projects` with the name and a **frontend-chosen random color from the palette**, obtaining the new project id.
2. AFTER all pending projects are created THEN the app SHALL submit the task (create or update) with `projectIds` = the ids of all badges (existing + newly created), containing only real ids.
3. IF creating a pending project returns 409 `CONFLICT` (a project with that name already exists — e.g. created meanwhile) THEN the app SHALL reconcile by using the existing project's id (from a refreshed project list / matched by case-insensitive name) instead of failing.
4. IF creating a pending project fails for another reason (e.g. 400 at the 20-project limit, network) THEN the app SHALL NOT submit the task, SHALL show a friendly message, and SHALL preserve the form state so the user can adjust.
5. WHEN the whole flow succeeds THEN the task list AND the project list SHALL reflect the new project(s) and assignment on next load (both read the same backend).
6. THE random color SHALL be chosen from the shared palette at creation time; the user does not choose or preview it (a new project simply gains a color).

### Requirement 6 — Consistency, accessibility, and reuse

**User Story:** As a user, I want the tag input to be accessible and consistent with the rest of the app.

#### Acceptance Criteria

1. THE tag input SHALL be keyboard-operable: type to filter, Arrow keys to move through suggestions, Enter/comma to confirm, Backspace to remove, Escape to dismiss the suggestion list.
2. THE input and suggestion list SHALL use appropriate ARIA (combobox/listbox semantics or equivalent) with visible focus states.
3. THE badges' color circles SHALL reuse the project `color`; palette selection SHALL reuse the shared palette constant used by the project form.
4. THE change SHALL be contained to the task form's project field; the Quick-Add and Modify flows, validation, and submit behavior otherwise remain as the task-views spec defined them.
5. Newly created projects SHALL be usable immediately as badges within the same task submission.

## Non-Goals

- Choosing or previewing the new project's color in the task form (random, front-assigned; the Projects page remains where colors are edited).
- Editing/deleting projects from the task form (projects-management spec owns that).
- Backend changes (color auto-assignment stays on the frontend for now).
- Allowing commas within project names created via this input (comma is a confirm key).
- Reordering or prioritizing projects here.

## Traceability

- Ultra-fast capture, minimal friction: PRD §3.2, §5.
- Multi-project tasks; Unassigned is automatic when no real project: PRD §3.3 + backend Unassigned revision.
- Projects have colors: projects-management spec (palette reused).
- Companion fix: task-views `TaskForm` must not send the default project id on Modify.
