# V5 V6 Unified Stabilization

## Goal

Stabilize the V5 `chat_dialogue_mv` and V6 `video_chain` product-entry control plane so input locking, scheduler evidence, preview/export lifecycle, revision behavior, and V6 acceptance evidence match the product contract before broader testing continues.

## What I Already Know

* The stabilization source document is `/mnt/c/Users/Jym/Downloads/tele/qivance-music-v5-v6-unified-stabilization-patch.md`.
* V6 already exists as a DB-backed `video_chain` project type with lyrics/audio/video upload, timing, MP4 background preview frames, revision controls, and final export controls.
* Current `video_chain` confirm creates the full preview plus final export scheduler chain. That conflicts with the V6 product rule that final MP4 export must be explicit.
* Current upload flow can create multiple active inputs of the same kind in one request, especially `lyrics_text + lyrics_file`.
* Current manifest input sha validation reads current active inputs, not the run's locked input snapshot.
* Current runner loop can overlap ticks in one process and does not drain in-flight work during shutdown.
* Current artifact recording skips missing declared outputs and can still mark a task passed.
* Current V6 runner tests mock html-video, render, mux, and ffprobe dependencies. Those tests are useful unit coverage but not sufficient V6 acceptance evidence.
* Current Workbench only treats current artifacts as ready and does not communicate stale final exports after preview revision.
* Existing unrelated dirty file: `docs/TEST_REPORT.v6-1test.md`. This task must not touch it unless explicitly folded into Patch D.

## User Decisions

* `POST /api/projects/:id/chains/video-chain/export/render` must create an asynchronous DB-backed export run and return `202 + run_id`.
* Export artifacts must be produced by scheduler tasks and linked through `Artifact.createdByRunId`.
* Migration cleanup must keep the newest active `ProjectInput` for each `project_id + kind`, mark older active rows `superseded`, then add the active uniqueness constraint.

## Requirements

* Preserve `chat_dialogue_mv` V5 behavior and focused regression coverage.
* Do not expand scope into SaaS, auth, users, permissions, DeepSeek, MiniMax, `image_storyboard_mv`, RAG asset pools, template marketplace, or distributed runner locks.
* Add a SQLite migration and Prisma schema support for:
  * one active `ProjectInput` per `project_id + kind`;
  * `SchedulerRun.locked_inputs_json`.
* Before adding the partial unique index, migrate existing duplicate active inputs by preserving the newest active row per `project_id + kind` and superseding the rest.
* Reject upload requests containing multiple inputs for the same kind, including `lyrics_text + lyrics_file`.
* Generate immutable input file paths from input IDs rather than timestamp-only names.
* Keep input upload, supersede, create, artifact stale marking, and status updates transactional where practical.
* Confirm inputs by materializing stable paths and writing a locked input snapshot containing input id, kind, sha256, immutable path, and stable path.
* Validate final manifests against the run locked input snapshot, not the current active input set.
* Split `video_chain` lifecycle:
  * confirm creates only preview tasks: `run_timing_pipeline`, `prepare_video_context`, `build_video_frames`;
  * explicit export creates export tasks: `render_video_visual`, `mux_video_final`, `video_qa_report`, `write_video_manifest`.
* Store enough phase/mode evidence in scheduler runs, tasks, events, or details so preview and export runs are distinguishable.
* Make V6 revision preview-only. A successful revision must not render, mux, create, or mutate final MP4 files.
* After successful V6 revision, mark existing `exports/video_chain/visual.mp4`, `exports/video_chain/final.mp4`, `data/chains/video_chain/qa_report.json`, and `exports/video_chain/render_manifest.json` artifact rows stale.
* Workbench must make stale final export state visible and keep explicit render/export controls clear.
* Add runner loop in-flight protection, graceful drain on shutdown, and stopRequested handling that prevents launching further queued tasks after the current running task settles.
* Record runner loop errors as scheduler events instead of silently swallowing interval-level failures.
* Required declared output artifacts must be enforced. Missing required output files must fail the task.
* Dynamic artifacts must support actual video-chain agent run log paths instead of literal placeholder paths.
* Add schema v6 render manifest validation for video_chain production manifests.
* Improve MP4 import/upload/confirm error mapping so fake MP4, no video stream, ffprobe failure, and source video import failures return clear 400/409 API errors rather than generic 500.
* Add a V6 E2E script/report path that distinguishes mock unit tests from real html-video runtime evidence.

## Acceptance Criteria

* [ ] Duplicate active `ProjectInput` rows are cleaned before the unique index is added, preserving only the newest active row per project/kind.
* [ ] DB constraint prevents two active `ProjectInput` rows for the same project/kind.
* [ ] Uploading `lyrics_text + lyrics_file` in one request fails with a clear invalid input error.
* [ ] Confirm writes `SchedulerRun.locked_inputs_json` with lyrics/audio/video data as appropriate.
* [ ] Manifest validation fails when the stable file sha does not match the locked run snapshot.
* [ ] Confirming complete `video_chain` inputs creates only preview phase tasks and does not produce final export artifacts.
* [ ] Explicit V6 export route creates an async DB-backed run, returns `202 + run_id`, and artifact rows point to that run.
* [ ] V6 revision refreshes preview but leaves final files untouched and marks previous export artifacts stale.
* [ ] Runner loop does not re-enter while a previous tick is in flight.
* [ ] Runner shutdown drains current handler work before disconnecting Prisma.
* [ ] stopRequested prevents starting additional queued tasks after a running handler finishes.
* [ ] Runner loop errors are recorded as scheduler events.
* [ ] Missing required task outputs fail the task.
* [ ] `build_video_frames` records current DB artifact rows for actual agent run logs.
* [ ] V6 manifest validator rejects invalid schema/version/chain/audio-policy/QA/production-gate values.
* [ ] MP4 import failures map to clear API 400/409 errors.
* [ ] V5 focused tests and V6 focused tests pass.
* [ ] Real V6 E2E evidence is recorded or explicitly blocked by missing local runtime dependencies without treating mocks as acceptance.
* [ ] `npm run typecheck` and `git diff --check` pass before final handoff.
* [ ] GitNexus impact checks are run before symbol edits, and `npx gitnexus detect-changes --repo qivance-music` is run before commit/handoff.

## Definition Of Done

* PRD and PLAN are present under this Trellis task.
* Patch A-D implementation is completed by delegated sub-agents under coordinator review.
* The coordinator reviews sub-agent diffs before moving to the next dependent patch.
* Focused tests for each patch pass before the next patch depends on them.
* Final verification includes typecheck, focused backend tests, V5/V6 test scripts, diff check, and GitNexus detect-changes where available.
* Documentation/test report distinguishes mock unit tests, integration tests, real html-video E2E evidence, and known blocked dependencies.

## Technical Approach

Patch A establishes durable input and run invariants. Patch B makes the runner and artifact evidence trustworthy. Patch C changes the V6 product lifecycle to preview-first and async explicit export. Patch D adds validators, hardened media errors, E2E evidence, scripts, and docs.

The patches should be coordinated sequentially because later patches depend on schema, task seed, handler signature, and artifact behavior from earlier patches. Sub-agents may use isolated workspaces, but their write scopes must be reviewed and integrated by the main coordinator.

## Decision (ADR-lite)

**Context**: V6 preview revision and explicit export semantics conflict with the current one-shot scheduler chain. Input and artifact evidence also need stronger invariants before real V6 testing can be trusted.

**Decision**: Use an asynchronous DB-backed export run for V6 final export. Keep only the newest duplicate active input during migration cleanup, supersede older active rows, and enforce one active input per project/kind at the DB level. Execute stabilization as Patch A-D with the coordinator integrating worker output.

**Consequences**: Export progress becomes traceable through scheduler runs/tasks/events, but Workbench/API must handle queued/running export status. The migration is more robust for dirty local data, but tests must prove deterministic cleanup. The patch series is larger than a narrow bug fix, so each slice needs focused verification.

## Out Of Scope

* SaaS, login, auth, users, permissions, Cloudflare Access, or Tailscale.
* DeepSeek lyric generation and MiniMax music generation.
* `image_storyboard_mv`.
* Source MP4 semantic understanding, automatic clipping, or final audio extraction from MP4.
* RAG asset pool, Obsidian import, source capsule generation, and template marketplace.
* Next.js/OpenDesign rewrite or high-fidelity UI redesign.
* Multi-process or distributed runner locking.
* Broad renaming from `project-inputs-v5.ts` to generic input modules unless needed to finish P0 safely.

## Technical Notes

* Current branch: `codex/planv5-track-trellis-files`.
* Existing active related task: `.trellis/tasks/06-16-v6-video-chain-product-entry/`.
* Relevant specs:
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/backend/v5-control-plane-runner-contracts.md`
  * `.trellis/spec/backend/v4-chat-scheduler-contracts.md`
* Relevant docs:
  * `docs/PLAN.v6.md`
  * `docs/SPEC.v6.md`
  * `docs/qivance_music_html_video_integration_prd.v6.md`
* Relevant modules:
  * `prisma/schema.prisma`
  * `src/lib/chain-registry/chain-registry.ts`
  * `src/lib/project-core/project-inputs-v5.ts`
  * `src/lib/scheduler/server-runner-loop.ts`
  * `src/lib/scheduler/db-run-store.ts`
  * `src/lib/scheduler/v5-task-handlers.ts`
  * `src/lib/video-chain/video-chain-runner.ts`
  * `src/lib/workbench/workbench-html.ts`
  * `src/server.ts`
* Relevant existing tests:
  * `tests/prisma-control-plane.test.ts`
  * `tests/chain-registry-v5.test.ts`
  * `tests/project-inputs-v5.test.ts`
  * `tests/server-runner-loop-v5.test.ts`
  * `tests/chat-dialogue-runner-v5.test.ts`
  * `tests/workbench-v5-api.test.ts`
  * `tests/source-video-import.test.ts`
  * `tests/video-chain-runner.test.ts`
