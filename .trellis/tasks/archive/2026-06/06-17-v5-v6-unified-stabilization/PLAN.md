# PLAN: V5 V6 Unified Stabilization

## Coordination Model

The main Codex session is the coordinator. Worker sub-agents implement the patches. The coordinator owns:

* task state and PRD/PLAN updates;
* patch ordering;
* sub-agent prompts and write-scope boundaries;
* diff review after each worker;
* focused verification before unlocking the next dependent patch;
* final quality pass and handoff.

Worker rules:

* Do not call `task.py create`, `task.py start`, `task.py add-context`, or archive tasks.
* Do not revert edits made by other agents.
* Run read-only inspection before edits.
* Run GitNexus impact analysis before editing any function, class, method, or model-adjacent symbol.
* Keep changes surgical and aligned to the assigned patch only.
* Report changed files, verification commands, failures, and remaining risks.

## Dependency Order

Patch A -> Patch B -> Patch C -> Patch D

Patch A must land first because later patches depend on DB shape and locked input snapshots.
Patch B must precede lifecycle work because scheduler task evidence must be trustworthy.
Patch C depends on Patch A/B and changes the user-facing V6 lifecycle.
Patch D depends on the final lifecycle and manifest shape.

## Patch A: Control Plane And Input Invariants

### Owner

Worker A.

### Write Scope

* `prisma/schema.prisma`
* `prisma/migrations/**`
* `src/lib/project-core/project-inputs-v5.ts`
* `src/lib/scheduler/v5-task-handlers.ts`
* supporting helper file only if it reduces duplication for locked input snapshots
* `tests/prisma-control-plane.test.ts`
* `tests/project-inputs-v5.test.ts`
* `tests/chat-dialogue-runner-v5.test.ts`
* new focused input snapshot test if needed

### Requirements

* Add `SchedulerRun.lockedInputsJson` mapped to `locked_inputs_json`.
* Add SQLite migration:
  * clean duplicate active inputs by keeping newest active row per `project_id + kind`;
  * supersede older active rows;
  * add partial unique index on active project/kind.
* Reject duplicate input kinds in one upload request, including `lyrics_text + lyrics_file`.
* Generate input paths from input IDs, not timestamp-only names.
* Confirm creates locked input snapshot and stores it on the run.
* Manifest sha validation uses run snapshot.

### Verification

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/prisma-control-plane.test.ts tests/project-inputs-v5.test.ts tests/chat-dialogue-runner-v5.test.ts
npm run typecheck
git diff --check
```

### Exit Criteria

Patch A is complete when tests prove duplicate active cleanup, DB uniqueness, upload duplicate rejection, locked snapshot creation, and snapshot-based sha validation.

## Patch B: Runner Loop And Artifact Evidence

### Owner

Worker B.

### Write Scope

* `src/lib/scheduler/server-runner-loop.ts`
* `src/lib/scheduler/db-run-store.ts`
* `src/lib/scheduler/v5-task-handlers.ts` only where handler return types need integration
* `src/lib/video-chain/video-chain-runner.ts` only to return actual dynamic artifacts
* `src/server.ts` only for shutdown drain integration
* `tests/server-runner-loop-v5.test.ts`
* `tests/video-chain-runner.test.ts`

### Requirements

* `startV5RunnerLoop` prevents single-process re-entry when a tick is in flight.
* `stop({ drain: true })` waits for current tick/handler before returning.
* shutdown drains runner before Prisma disconnect.
* stopRequested prevents launching the next queued task after a running task finishes.
* runner loop errors are recorded as scheduler events instead of being swallowed.
* Required static outputs missing on disk fail the task.
* Dynamic artifact outputs record actual returned artifact refs.
* `build_video_frames` records actual video-chain agent run log artifacts.

### Verification

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/server-runner-loop-v5.test.ts tests/video-chain-runner.test.ts
npm run typecheck
git diff --check
```

### Exit Criteria

Patch B is complete when runner non-reentry, drain, stop continuation, loop-error event, missing-output failure, and dynamic agent artifact tests pass.

## Patch C: V6 Lifecycle Split And Async Export

### Owner

Worker C.

### Write Scope

* `src/lib/chain-registry/chain-registry.ts`
* `src/lib/project-core/project-inputs-v5.ts`
* `src/lib/scheduler/v5-task-handlers.ts`
* `src/server.ts`
* `src/lib/workbench/workbench-html.ts`
* `tests/chain-registry-v5.test.ts`
* `tests/project-inputs-v5.test.ts`
* `tests/workbench-v5-api.test.ts`
* new `tests/video-chain-lifecycle.test.ts`

### Requirements

* Registry can build preview-only seeds for `video_chain`.
* Confirm creates preview phase only.
* Preview completion results in preview-ready status semantics without final export artifacts.
* Explicit export route creates asynchronous DB-backed `production_export` run with export tasks and returns `202 + run_id`.
* Export artifacts are linked to the export run.
* V6 revision remains preview-only.
* Successful revision marks previous export artifacts stale.
* Workbench communicates missing/stale/current final export states.

### Verification

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/chain-registry-v5.test.ts tests/project-inputs-v5.test.ts tests/workbench-v5-api.test.ts tests/video-chain-lifecycle.test.ts
npm run typecheck
git diff --check
```

### Exit Criteria

Patch C is complete when confirm no longer creates final export tasks, export route creates a DB-backed run, revision stales old exports, and Workbench/API tests cover the lifecycle.

## Patch D: Validators, E2E Evidence, Scripts, And Docs

### Owner

Worker D.

### Write Scope

* `src/lib/export/render-manifest-v6.ts`
* `src/lib/video-chain/video-chain-runner.ts`
* `src/lib/video-html/**` only for frame semantic validator integration
* `src/lib/project-core/project-inputs-v5.ts` or `src/server.ts` only for MP4 error mapping left after Patch A/C
* `scripts/e2e-v6-video-chain-product-entry.ts`
* `package.json`
* `docs/TEST_REPORT.v6.md`
* `docs/SPEC.v6.md` only if behavior contract changes
* `tests/render-manifest-v6.test.ts`
* `tests/video-chain-frame-validation.test.ts`
* `tests/source-video-import.test.ts`
* `tests/video-chain-runner.test.ts`

### Requirements

* Validate schema version 6 manifests before writing or reporting success.
* Enforce video-chain manifest production gates, MP3 final audio source, ignored MP4 audio policy, exactly one final audio stream, and duration drift <= 150ms.
* Harden video frame semantics for locked MP4 background, muted/no controls, no remote/data/blob/file source URLs, no source-video audio usage, and overlay presence where practical.
* Map fake MP4, no video stream, ffprobe failure, and import failure to clear API errors.
* Add `test:v5`, `test:v6`, `test:backend`, and `e2e:v6` package scripts.
* Add real V6 E2E script and update docs/test report to separate mocks from real runtime evidence.

### Verification

```bash
npm run typecheck
npm run test:v5
npm run test:v6
npm run test:backend
TMPDIR=/tmp npm run e2e:v6
git diff --check
```

If real local dependencies are unavailable, `e2e:v6` may document an explicit blocked state, but unit mocks must not be counted as product acceptance.

### Exit Criteria

Patch D is complete when validators, hardened errors, scripts, and docs are in place, and test report evidence clearly identifies mock, integration, real E2E, and known gaps.

## Final Integration Checklist

* Re-run Trellis backend spec compliance against `.trellis/spec/backend/v5-control-plane-runner-contracts.md`.
* Run focused V5 and V6 tests.
* Run `npm run typecheck`.
* Run `git diff --check`.
* Run `npx gitnexus analyze --index-only --name qivance-music` if structural changes affect symbol graph.
* Run `npx gitnexus detect-changes --repo qivance-music`.
* Review dirty state and separate unrelated `docs/TEST_REPORT.v6-1test.md` unless explicitly included later.
