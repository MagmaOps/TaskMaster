# Task Management Implementation Tasks

Builds on auth-system and the existing schema (tasks, projects, task_projects, deferrals). No new migrations. Tasks marked `*` are optional. All core tasks complete and verified (50 tests passing across the backend).

- [x] 1. Weight algorithm module (pure)
  - Implemented `src/services/tasks/weight.ts`: `calculateWeight`, `calculateWeightBreakdown`, `dueMomentOf`, `projectMultiplier`, injectable `now`
  - Continuous hours-based due proximity (due moment = due_date + due_time, or 23:59:59 when no time)
  - Constants: priority 3/2/1, deferral +5, overdue ×10/day, due-soon max 35 over 7 days (continuous), repeatable-today ×2
  - _Requirements: 3.1–3.10_

- [x] 2. Unit tests for weight (17 passing)
  - Base age+priority, overdue, continuous due-soon curve, same-day earlier due_time outweighs later, no-due-time = end-of-day, project multiplier (1/N/disabled/unassigned), deferral accumulation, repeatable ×2, no-due-date, determinism, integer output
  - _Requirements: 3.1–3.10_

- [x] 3. Types + repositories
  - [x] 3.1 `src/types/task.ts` (TaskRow, TaskWithMeta, TaskDTO, RepeatPattern, Create/Update inputs, DeferOption)
  - [x] 3.2 `taskRepository` (create, findActiveByUser with deferral counts + projects json in one query, findByIdForUser, update, setCompleted, applyDefer, archive, transactional associations)
  - [x] 3.3 `deferralRepository.record`
  - [x] 3.4 `projectReadRepository` (listForUser, assertOwned)
  - _Requirements: 1–8_

- [x] 4. taskService
  - [x] 4.1 create (validate repeatPattern + project ownership, associate, return with weight)
  - [x] 4.2 list (load user weight context: projects + settings + tier; compute weight + optional breakdown; sort desc)
  - [x] 4.3 update (partial; replace project associations)
  - [x] 4.4 complete (set completed_at, capture weightAtCompletion, invoke injectable onCompleted hook; 404 vs 409)
  - [x] 4.5 defer (later_today/tomorrow/sometime_later mutations + record deferral)
  - [x] 4.6 archive (soft delete)
  - Includes pg date/time normalization (DATE/TIMESTAMPTZ come back as Date; coerced to strings)
  - _Requirements: 1–8_

- [x] 5. Controller + routes + validation
  - [x] 5.1 `taskController` (list/create/update/complete/defer/remove)
  - [x] 5.2 express-validator rules (subject 1–500, priority enum, date/time regex, project UUIDs, defer option enum)
  - [x] 5.3 `taskRoutes` mounted at `/api/tasks` behind authMiddleware; wired into app.ts
  - _Requirements: 8.1–8.3_

- [x] 6. Integration tests (Supertest + test DB) — part of 50 passing
  - create→list ordering; ownership isolation (404 across users); complete + 409; defer effects + deferral row; sometime_later downgrade + clear; archive hides task; validation 400; auth required; premium weight_breakdown present vs omitted for free
  - _Requirements: 1.1, 2.1, 2.3, 2.6, 4.4, 5.1, 5.2, 6.2–6.5, 7.1, 8.2_

- [x] 7. Verify end-to-end against running dev DB
  - Live smoke: created tasks with varied priority/due times, confirmed continuous due-time ordering + overdue handling via weight breakdown, defer (dueDate + deferralCount + weight rise), complete (200) + re-complete (409); typecheck + `npm test` green
  - _Requirements: all_

- [ ]* 8. Optional
  - [ ]* 8.1 Bulk endpoints or pagination if the active list grows large (deferred; personal scale is fine without)
