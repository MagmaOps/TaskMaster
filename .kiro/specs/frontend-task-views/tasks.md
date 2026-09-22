# Frontend Task Views / "What's Next?" — Tasks

- [ ] 1. Add task/project API types and wrappers
  - Extend `src/api/types.ts` with `TaskDTO`, `TaskProjectRef`, `RepeatPattern`, `DeferOption`, `CreateTaskInput`, `UpdateTaskInput`, `UnlockedAchievement`, `WeightBreakdown`, `ProjectDTO` (mirror backend exactly).
  - `src/api/tasks.ts`: `listTasks`, `createTask`, `updateTask`, `completeTask`, `deferTask`, `archiveTask` (unwrap + normalizeError).
  - `src/api/projects.ts`: `listProjects()`.
  - _Requirements: 1.1, 1.2, 3.5, 4.2, 5.2, 6.1_

- [ ] 2. Build the accessible Modal primitive
  - `src/components/common/Modal.tsx` (+css): portal, `role="dialog"`+`aria-modal`, title label, focus trap, Escape + overlay close, body scroll lock, focus restore.
  - _Requirements: 3.8, 4.5_

- [ ] 3. Implement TaskContext
  - `src/contexts/TaskContext.tsx`: state (tasks/status/error/filterProjectId), `loadTasks`, `setFilterProjectId`, `createTask`, `updateTask`, `completeTask`, `deferTask`, `archiveTask` (re-fetch after mutation), quick-add open/close state (DD-4), `useTasks` throws outside provider.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [ ] 4. Unit-test TaskContext
  - load populates in server order; filter refetch with project_id; complete/defer/archive refetch + reconcile; error path; throws outside provider.
  - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.7_

- [ ] 5. Formatting + achievement copy utils
  - `src/utils/taskFormat.ts` (due date/time + priority label via date-fns) and `src/utils/achievementCopy.ts` (type -> friendly text + fallback). Unit tests for both.
  - _Requirements: 2.3, 7.2_

- [ ] 6. Build TaskCard (top + list variants)
  - `src/components/tasks/TaskCard.tsx` (+css): subject, priority badge, due date/time, project tags, repeatable indicator; `variant="top"` prominent "What's Next?", `variant="list"` compact; no weight number.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7_

- [ ] 7. Build TaskForm + QuickAddModal
  - `src/components/tasks/TaskForm.tsx`: subject (autofocus, 1–500), priority (default medium), collapsible optional (due date/time, project multi-select, repeatable toggle + daily/weekly pattern with day checkboxes), maps to Create/UpdateTaskInput, client validation.
  - `src/components/tasks/QuickAddModal.tsx`: create flow → createTask → close; server error preserves values.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 8. Unit-test Quick-Add / TaskForm
  - subject required + autofocus; optional collapsed; weekly reveals days; valid submit calls createTask + closes; server error preserves values.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

- [ ] 9. Build ActionModal + DeferralModal
  - `ActionModal.tsx`: Complete / Later / Modify / Archive / Delete; Complete→completeTask (+celebration); Modify→TaskForm edit→updateTask; Archive→archiveTask; Delete→confirm→archiveTask; pending states.
  - `DeferralModal.tsx`: Later Today / Tomorrow / Sometime Later with friendly copy → deferTask(option).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 10. Unit-test Action + Deferral flow
  - options present; Complete calls completeTask + fires celebration when unlocked (suppressed when toasts disabled); Later sends correct option; Delete confirms; Escape/focus-trap.
  - _Requirements: 4.2, 4.4, 5.2, 7.1, 7.4_

- [ ] 11. Build ProjectSelector with Focus pill
  - `src/components/tasks/ProjectSelector.tsx`: single-select pill row [Focus icon][All][Unassigned][project…]; selection = discriminated `{kind:'focus'|'all'|'project', id?}` in TaskContext driving fetch + render mode; Focus mutually exclusive; aria-pressed/selected styling + accessible labels.
  - Add a small focus-themed placeholder PNG (generated, like the app icons) under `public/icons/` (or `src/assets/`); real art deferred to branding pass.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [ ] 12. Build TaskList page + wire routing and BottomNav +
  - `src/pages/TaskList.tsx`: ProjectSelector, top task + list (or Focus Mode), loading/error/retry/empty-state CTA, tap→ActionModal, mount QuickAddModal.
  - Edit `App.tsx` (Tasks route → TaskList) and `BottomNav.tsx` (center + opens Quick-Add), mount `TaskProvider` in `main.tsx`.
  - _Requirements: 2.1, 2.2, 2.5, 2.6, 3.1, 6.4_

- [ ] 13. Unit-test TaskList + selector + celebration integration
  - top task prominent + rest below; empty state CTA opens Quick-Add; selecting Focus pill shows only top task; selecting a project refetches with project_id; completion celebration toast appears when unlocked returned.
  - _Requirements: 2.1, 2.6, 6.2, 6.5, 7.1_

- [ ] 14. Finalize verification
  - `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` all green.
  - Manual smoke against live backend: create task, see it appear; complete (observe achievement toast on first task); defer each option; filter by project; toggle Focus Mode. Clean up any smoke data.
  - _Requirements: all_
