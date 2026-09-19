# Projects Management Implementation Tasks

Builds on auth + task-management + existing `projects`/`task_projects` tables. Delivers the full `projectRepository` that supersedes the temporary `projectReadRepository`. All core tasks complete and verified (63 tests passing across the backend). Tasks marked `*` are optional.

- [x] 1. Types
  - `src/types/project.ts`: ProjectRow, ProjectWithCount, ProjectDTO, CreateProjectInput, UpdateProjectInput

- [x] 2. Migration for reorder safety
  - `1000000000002_projects_priority_deferrable`: replace the plain unique INDEX on (user_id, priority_order) with a DEFERRABLE INITIALLY DEFERRED unique CONSTRAINT so multi-row reorders don't hit transient collisions (uniqueness checked at COMMIT). Applied to dev; test DB re-migrates via globalSetup.

- [x] 3. projectRepository (`src/repositories/projectRepository.ts`)
  - Reads: listForUserWithCounts (active counts), listForUser (id+priority_order), countForUser, findByIdForUser, findByNameForUser (case-insensitive), assertOwned
  - create (transactional next order = MAX+1), update (name/color), reorder (single-pass under deferred constraint), remove (delete + close gap; associations cascade, tasks preserved)

- [x] 4. projectService (`src/services/projects/projectService.ts`)
  - create (20-max + case-insensitive uniqueness), list, update (uniqueness excluding self), reorder (validate id set == user's full set), delete

- [x] 5. Controller + routes + validation
  - projectController; express-validator (name 1–255, color #RRGGBB, reorder projectIds UUID array)
  - projectRoutes at `/api/projects`; `PUT /reorder` before `/:id`; wired into app.ts

- [x] 6. Refactor: unify repositories
  - taskService points at projectRepository (listForUser, assertOwned); deleted projectReadRepository.ts; full suite still green

- [x] 7. Tests
  - Unit (mocked repo): 20-max, duplicate name (create+update), reorder set-mismatch
  - Integration: create/list-with-counts (active only), 20-max, duplicate 409, reorder + contiguity + wrong-set 400, delete closes gap + keeps task (task survives, unassigned), ownership isolation, reorder changes task weight ordering

- [x] 8. Verify
  - typecheck + full `npm test` green (63 tests, 8 suites)

- [ ]* 9. Optional
  - [ ]* 9.1 Live smoke against dev DB (covered by integration tests; can do during frontend wiring)
