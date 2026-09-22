# Frontend Task Project Tag-Input — Tasks

- [ ] 1. Extract shared palette util
  - `src/utils/projectColor.ts`: `PALETTE` (the 8 swatches) + `randomPaletteColor()`. Refactor `ProjectFormModal` to import `PALETTE` from here (no behavior change). Unit test: palette non-empty, random returns a member.
  - _Requirements: 5.6, 6.3_

- [ ] 2. Build ProjectTagInput
  - `components/tasks/ProjectTagInput.tsx` (+css): chips (existing = `● Name` when colored / pending = name only) + text input + suggestion listbox; props `{ projects, value: Chip[], onChange, error? }`.
  - Confirm logic (Enter/comma): trim; reject 'unassigned' (inline hint); reuse existing by case-insensitive match; ignore duplicate; else pending chip. Backspace-on-empty removes last chip. Escape closes list. Suggestions exclude default + already-chosen, case-insensitive substring.
  - ARIA combobox/listbox + keyboard (Arrow/Enter/comma/Backspace/Escape) + visible focus.
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 6.1, 6.2_

- [ ] 3. Unit-test ProjectTagInput
  - case-insensitive filter; existing/default/chosen excluded; Enter existing-name (any case) -> existing chip no dup; Enter/comma new name -> pending chip; duplicate ignored; 'Unassigned' rejected + hint; Backspace removes last; comma confirms.
  - _Requirements: 2.1, 3.2, 3.3, 3.4, 3.5, 4.1_

- [ ] 4. Integrate into TaskForm (chips model + save flow)
  - Replace checkbox list with `<ProjectTagInput>`; chips state seeded from real projects (reuse default-exclusion fix). On submit: create pending projects via injected `createProject({name,color:randomPaletteColor()})`, reconcile 409 by name (re-fetch), abort+message on other errors, then submit task with combined real `projectIds`.
  - Thread `createProject` + project list/reconcile from `ProjectContext` at call sites (TaskList QuickAdd, ActionModal Modify).
  - _Requirements: 1.3, 5.1, 5.2, 5.3, 5.4, 5.5, 6.4, 6.5_

- [ ] 5. Unit-test TaskForm save flow
  - modify Unassigned submits projectIds []; pending chip -> createProject called with palette color then task submitted with new id; 409 reconciles to existing id + still submits; 400 limit aborts + preserves chips + message.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 6. Finalize verification
  - typecheck / test / lint / build green.
  - Live smoke: create task typing a brand-new project name (Enter) -> task created + new project appears (with a color) on Projects page and as a badge; modify an Unassigned task adding an existing project (case-insensitive) -> saves; comma confirm; Backspace removal. Clean up smoke data.
  - _Requirements: all_
