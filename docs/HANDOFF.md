# TaskMaster — Session Handoff

## Paste this to the new Kiro session

> I am continuing a rebuild of TaskMaster (weight-based task-management SaaS, self-hosted on k3s via ArgoCD). Read these first, in order, as ground truth: `docs/BUILD-STATE.md` (full handoff — what is done, working process, environment gotchas, DB schema, what is next), `docs/prd.md` and `docs/technical-specification.md` (product + technical vision), and the specs under `.kiro/specs/`.
>
> Working agreement: one logical abstraction per spec; for each feature write spec -> I review and confirm -> then implement -> verify (`npm run typecheck` + `npm test` must stay green). No leftover/waste files. Autopilot is on: create/edit code without asking, but keep the spec-confirmation gate.
>
> Before doing anything, confirm the environment is healthy: `docker compose up -d` (dev + test Postgres), then `cd task-master-server && npm test` should show **184 tests passing across 27 suites**, and `npm run typecheck` clean.
>
> The backend is feature-complete (auth, task-management, projects + Unassigned, completion-events, economy, user-timezone, streaks, achievements, task-recurrence, analytics — all done and tested). **Next up is the frontend** (`task-master-front/`, greenfield React 18 + TypeScript + Vite PWA). It is large, so I want to break it into smaller sequential specs (proposed order: app-shell + auth, then task views / What is Next, then projects, then profile + settings + dark mode), each through the spec->confirm->build->verify loop. Start by proposing the frontend spec breakdown and writing the FIRST spec (app-shell + auth) requirements + design for my review. After the frontend: Dockerfiles + k8s/ArgoCD manifests.
>
> Trust the code and tests on disk over any memory.

## Current state (as of this handoff)

- **Backend:** feature-complete. 184 tests / 27 suites green; typecheck clean.
- **Latest work (uncommitted, see commit note below):** achievements, task-recurrence, projects-management **Unassigned-project revision** (migration `1000000000005`), and analytics.
- **DB migrations applied to dev through `1000000000005_default_project`.** Test DB re-migrates via Jest globalSetup.
- **Frontend:** not started (`task-master-front/` is empty/greenfield).
- **k8s/ArgoCD:** not started.

## Environment gotchas (also in BUILD-STATE — read that section)

- **Windows/MINGW shell is unreliable for file writes:** heredocs (even `<<'EOF'`) and long `printf`/`python3 -c` batches get scrambled or wedge the session (exit 256 on everything). Prefer the editor write/edit tools; when using the shell, write ONE short line per `printf` call, or a `python3 - <<PY` script reading replacement text from files. `/tmp` in MINGW maps to `C:\Users\<user>\AppData\Local\Temp` (Windows Python needs that absolute path, not `/tmp`). If the shell wedges, ask the user to restart Kiro.
- **pg returns DATE/TIMESTAMPTZ as JS Date** (at server-local midnight for DATE) — use LOCAL getters to recover YYYY-MM-DD, never UTC getters; or cast `::text` in assertion queries.
- **All "today"/"now" for weight/defer/streaks/achievements/recurrence/analytics** use the user timezone via `src/services/time/userTime.ts` (`localCalendarDate`/`resolveTimezone`), never server-local; only calendar-day comparisons use the zoned date.
- **fast-check date generators:** do NOT use `fc.date().toISOString()` (throws RangeError on boundary values under some seeds). Generate integer y/m/d (day 1-28) or epoch-ms integers. Always run property suites under the FULL suite, not just in isolation (seed-dependent flakiness).

## Uncommitted changes in this session

Four completed backend features (all verified green). Summary:

- **achievements** — completion listener unlocking milestones, `GET /api/achievements` (config, repo, service, controller, routes, tests).
- **task-recurrence** — completion listener regenerating the next occurrence of a repeatable task (pure `recurrence.ts`, `recurrenceService.ts`, `taskRepository.createOccurrence`, tests).
- **projects-management Unassigned revision** — migration `1000000000005_default_project` (is_default column, CHECK 0-20, one-per-user partial index, backfill), exclusive Unassigned membership, weight-neutral, protected, `ensureDefault` on user creation, tests. Touches projectRepository/taskRepository/projectService/taskService/authService/types + 5 pre-existing tests updated.
- **analytics** — read-only `GET /api/analytics/projects` (repo aggregate, service, controller, routes, tests).

**Cleanup done this session:** removed two junk artifacts (`=` 0-byte file and `bash.exe.stackdump`) created by the wedged shell.

**Note:** `.kiro/specs/achievements/tasks.meta.json` is a Kiro-generated spec metadata file (not gitignored). Safe to commit or ignore — your call.

## Suggested commit message (< 100 chars)

```
feat(backend): add achievements, task-recurrence, unassigned project, and analytics
```

Verify before committing: `cd task-master-server && npm run typecheck && npm test` (expect 184/27 green). Stage specific files (avoid `git add -A` so junk/metadata are intentional). We are on `main`; prior commit was the timezone + streaks work.

