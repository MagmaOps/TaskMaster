# Frontend Projects Management — Tasks

- [ ] 1. Extend project API wrappers + types, add @dnd-kit
  - `api/types.ts`: add `CreateProjectInput`, `UpdateProjectInput`.
  - `api/projects.ts`: add `createProject`, `updateProject`, `deleteProject`, `reorderProjects` (unwrap + normalizeError).
  - Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
  - _Requirements: 1.1, 3.3, 4.2, 5.3, 6.3_

- [ ] 2. Implement ProjectContext
  - `contexts/ProjectContext.tsx`: state (projects/status/error), `loadProjects`, `createProject`, `updateProject`, `deleteProject` (re-fetch after), `reorderProjects` (set from response, re-fetch on failure + rethrow), `useProjects` throws outside.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 3. Unit-test ProjectContext
  - load order; create/edit/delete refetch; reorder sets from response; reorder failure reverts + rethrows; error path; throws outside provider.
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [ ] 4. Build ProjectFormModal (create + edit)
  - `components/projects/ProjectFormModal.tsx`: shared name (1–255, autofocus) + color (preset palette + clear); mode create/edit; client validation; friendly 409/limit mapping; server error preserves values.
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 4.1, 4.2, 4.3, 4.5_

- [ ] 5. Build DeleteProjectDialog
  - `components/projects/DeleteProjectDialog.tsx`: confirm modal explaining tasks are kept (return to Unassigned); confirm → deleteProject; friendly error.
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 6. Build ProjectRow + ProjectList with dnd-kit reorder
  - `ProjectRow.tsx`: sortable item — drag handle (☰, aria-label), swatch, name, task count, Edit/Delete; default variant hides handle + actions.
  - `ProjectList.tsx`: DndContext + SortableContext (Pointer + Keyboard sensors); Unassigned pinned outside; onDragEnd → arrayMove → optimistic order + reorderProjects(realIds); revert + toast on failure; no priority numbers.
  - _Requirements: 2.2, 2.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 7. Build ProjectManagement page + wire routing/provider
  - `pages/ProjectManagement.tsx`: load on mount; split Unassigned/real; New-project button (disabled at 20 with hint); loading/error-retry/empty-CTA/ready; owns modal state (create/edit/delete).
  - Edit `App.tsx` (Projects route → ProjectManagement) and `AppShell.tsx` (mount ProjectProvider).
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 3.1, 3.5, 7.1_

- [ ] 8. Unit-test page + form + delete + reorder
  - page: Unassigned first no affordances, real projects, empty CTA, New disabled at 20; form: name required, create calls + closes, duplicate 409 friendly + preserves, edit pre-fills; delete: confirm calls deleteProject + explains kept tasks; list: onDragEnd calls reorderProjects with new real-id order, Unassigned not draggable.
  - _Requirements: 2.3, 2.5, 3.4, 4.2, 5.2, 6.2, 6.3_

- [ ] 9. Finalize verification
  - typecheck / test / lint / build all green.
  - Manual smoke against live backend: create a couple projects, rename, recolor, drag to reorder (verify order persists on reload), delete one (verify its tasks fall back to Unassigned), confirm Unassigned has no edit/delete/drag. Clean up smoke data.
  - _Requirements: all_
