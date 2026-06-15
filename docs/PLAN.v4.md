# V4 Chat Dialogue MV And Scheduler Implementation Plan

> **Source PRD:** `docs/qivance_music_html_video_integration_prd.v4.md`
> **Source SPEC:** `docs/SPEC.v4.md`
> **Status:** Draft
> **Tech stack:** TypeScript, Node HTTP server, file-system project model, html-video packages, existing audio/timing runners, ffmpeg/ffprobe, Playwright/Chrome where available.

---

## 0. Implementation Rules

- Keep V4 file-model first. Do not introduce Prisma, SQLite, Postgres, Redis, BullMQ, or any database-backed queue.
- Scheduler state is coordination state only. Project artifacts remain the source of acceptance truth.
- Preserve V3 production-strict behavior. Diagnostic fallback cannot satisfy V4 production success.
- Do not implement upstream content generation: no DeepSeek lyrics, MiniMax music, Obsidian/RAG, upload, or project creation wizard.
- Do not rewrite the frontend stack. Extend the current Node-served Workbench.
- Do not write chain output to `exports/final.mp4`; V4 chat output belongs under `exports/chat_dialogue_mv/**`.
- Do not overwrite stale artifacts automatically. Mark stale and require an explicit rerun/refresh path.
- Tests should isolate external dependencies first; live production E2E records evidence in `docs/TEST_REPORT.v4.md`.

---

## 1. File Structure

### Create

```text
docs/TEST_REPORT.v4.md

src/lib/scheduler/scheduler-config.ts
src/lib/scheduler/scheduler-types.ts
src/lib/scheduler/scheduler-events.ts
src/lib/scheduler/resource-locks.ts
src/lib/scheduler/execution-plan.ts
src/lib/scheduler/run-queue.ts
src/lib/scheduler/scheduler-status.ts
src/lib/scheduler/scheduler-runner.ts

src/lib/chat-dialogue/lyrics-line-map.ts
src/lib/chat-dialogue/speaker-attribution.ts
src/lib/chat-dialogue/line-timing.ts
src/lib/chat-dialogue/conversation-plan.ts
src/lib/chat-dialogue/chat-animation-plan.ts
src/lib/chat-dialogue/chat-frame-contracts.ts
src/lib/chat-dialogue/chat-frame-html.ts
src/lib/chat-dialogue/chat-chain-status.ts
src/lib/chat-dialogue/chat-qa-report.ts

src/lib/export/render-manifest-v4.ts

tests/scheduler-task-model.test.ts
tests/scheduler-execution-plan.test.ts
tests/scheduler-resource-locks.test.ts
tests/scheduler-run-queue.test.ts
tests/scheduler-recovery.test.ts
tests/chat-lyrics-line-map.test.ts
tests/chat-speaker-attribution.test.ts
tests/chat-conversation-plan.test.ts
tests/chat-animation-plan.test.ts
tests/chat-frame-contracts.test.ts
tests/chat-chain-api.test.ts
tests/render-manifest-v4.test.ts
tests/workbench-scheduler-html.test.ts

scripts/e2e-chat-dialogue-v4.ts
scripts/e2e-scheduler-v4.ts
```

### Modify

```text
src/server.ts
src/lib/workbench/project-status.ts
src/lib/workbench/workbench-html.ts
src/lib/project-core/paths.ts
src/lib/video-html/frame-output-contract-validator.ts
src/lib/video-html/preview-model.ts
src/lib/export/mux-locked-audio.ts
src/lib/export/media-qa.ts
docs/requirements traceability matrix.md
```

Exact file names may be adjusted during implementation if existing modules provide a better home, but the responsibilities must remain close to the SPEC boundaries.

---

## Task 1: Scheduler Types And Config

### Goal

Define the V4 scheduler data model and conservative local defaults.

### Implement

- Add `scheduler-types.ts` for task, run, resource, status, event, and config types.
- Add `scheduler-config.ts` to read `scheduler/scheduler_config.json`.
- Provide conservative defaults when config is missing.
- Validate resource limits:
  - positive integers
  - known resource names only
  - `project_parallelism >= 1`
  - `chain_parallelism_per_project >= 1`
- Keep all paths storage-root relative in serialized JSON.

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-task-model.test.ts
```

### Acceptance

- Missing config produces safe defaults.
- Invalid config returns stable validation issues.
- Types cover all V4 task statuses and resources.

---

## Task 2: Scheduler Event Log

### Goal

Create append-only logs for scheduler and project task events.

### Implement

- Add `scheduler-events.ts`.
- Write JSONL events to:
  - `scheduler/scheduler_events.jsonl`
  - `projects/<id>/data/scheduler/task_events.jsonl`
- Support required event types from SPEC:
  - `run_created`
  - `execution_plan_written`
  - `task_ready`
  - `task_blocked`
  - `task_started`
  - `task_passed`
  - `task_failed`
  - `task_skipped`
  - `task_cancelled`
  - `resource_lock_acquired`
  - `resource_lock_released`
  - `resource_lock_stale`
  - `run_completed`
  - `run_failed`
  - `run_cancelled`
- Include `run_id`, `project_id`, `chain_id`, `task_id`, timestamp, message, and details.

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-task-model.test.ts
```

### Acceptance

- Events append without rewriting prior events.
- Invalid event payloads are rejected before writing.
- Project event log and global event log can both be written.

---

## Task 3: Resource Locks

### Goal

Prevent heavy tasks from over-consuming local resources.

### Implement

- Add `resource-locks.ts`.
- Read/write `scheduler/resource_locks.json`.
- Acquire all task-required locks atomically at the file-model level.
- Enforce limits from scheduler config.
- Release locks for all terminal task statuses.
- Detect stale locks using `stale_after`.
- Do not silently ignore stale locks; write `resource_lock_stale` event.

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-resource-locks.test.ts
```

### Acceptance

- Lock count never exceeds resource limit.
- Multi-resource acquisition either succeeds fully or fails without partial locks.
- Cancelled/failed tasks release locks.
- Stale lock detection is visible in event log.

---

## Task 4: Execution Plan Builder

### Goal

Turn project and chain requests into dependency-aware task plans.

### Implement

- Add `execution-plan.ts`.
- Build `projects/<id>/data/scheduler/execution_plan.json`.
- Snapshot input artifacts and hashes.
- Generate shared dependency tasks before chain-private tasks.
- Enforce a single timing writer per project.
- Mark valid existing artifacts as `skipped` or `passed`.
- Mark stale artifacts without overwriting.
- Generate V4 chat task stages:
  - `resolve_project_inputs`
  - `resolve_timing_bundle`
  - `run_timing_pipeline`
  - `build_lyrics_line_map`
  - `build_speaker_attribution`
  - `build_conversation_plan`
  - `build_chain_animation_plan`
  - `build_chat_frame_contracts`
  - `build_chat_frames`
  - `validate_frames`
  - `build_preview`
  - `render_visual`
  - `mux_audio`
  - `run_media_qa`
  - `write_render_manifest`
  - `write_chain_status`
- Allow image storyboard and source video chains to be represented as existing V3 API-backed tasks without rewriting their internals.

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-execution-plan.test.ts
```

### Acceptance

- Single chat chain plan has ordered dependencies.
- Single project multi-chain plan shares timing task once.
- Existing valid artifacts skip redundant tasks.
- Stale artifacts are reported but not overwritten.

---

## Task 5: Run Queue And Fair Scheduling

### Goal

Support multi-project and multi-chain ready task selection.

### Implement

- Add `run-queue.ts`.
- Read/write `scheduler/run_queue.json`.
- Support run creation for:
  - one project one chain
  - one project multiple chains
  - multiple projects
- Select eligible ready tasks only when dependencies are terminal `passed` or `skipped`.
- Implement project-level fair rotation.
- Use `priority` only as a tie-breaker within fairness/resource constraints.
- Respect `project_parallelism` and `chain_parallelism_per_project`.

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-run-queue.test.ts
```

### Acceptance

- A large project cannot monopolize ready task selection.
- Priority cannot bypass unmet dependencies.
- Failed task blocks only dependent downstream tasks.
- Queue state persists to disk.

---

## Task 6: Scheduler Resume, Cancel, And Status

### Goal

Make scheduler state observable and recoverable after interruption.

### Implement

- Add `scheduler-status.ts`.
- Add `scheduler-runner.ts` orchestration helpers.
- Implement cancel:
  - mark non-terminal tasks cancelled
  - release locks
  - write `run_cancelled`
- Implement resume:
  - rescan project artifacts
  - keep valid outputs
  - requeue incomplete ready tasks
  - mark stale outputs
- Build summary for Workbench/API:
  - ready/running/blocked counts
  - active projects/chains
  - resource locks
  - waiting tasks

### Tests

```bash
node --experimental-strip-types --test tests/scheduler-recovery.test.ts
```

### Acceptance

- Resume does not overwrite valid artifacts.
- Cancel releases locks.
- Status can be rendered without reading every artifact file manually.

---

## Task 7: Lyrics Line Map

### Goal

Create a verbatim source map from `lyrics.md`.

### Implement

- Add `lyrics-line-map.ts`.
- Exclude blank lines, Markdown headings, and pure section labels.
- Preserve `raw_text` exactly except newline removal.
- Generate `display_text` by removing only recognized role prefix and surrounding whitespace.
- Record excluded lines with reason.
- Write `data/chains/chat_dialogue_mv/lyrics_line_map.json`.
- Validate no lyric line has empty `display_text`.

### Tests

```bash
node --experimental-strip-types --test tests/chat-lyrics-line-map.test.ts
```

### Acceptance

- Raw lyric text is traceable to line number.
- Prefix removal never rewrites substantive lyric text.
- Headings and section labels are excluded with explicit reasons.

---

## Task 8: Speaker Attribution

### Goal

Assign lyric lines to left/right chat speakers deterministically.

### Implement

- Add `speaker-attribution.ts`.
- Implement precedence:
  1. `A/B/甲/乙` role labels
  2. `Q/Question/问/提问` question labels
  3. `Answer/答/回答` answer labels
  4. `A:` as answer only when nearest explicit question context exists
  5. question punctuation or question words
  6. context alternation
  7. default fallback alternation
- Assign confidence values.
- Count low-confidence assignments below `0.7`.
- Write `speaker_attribution.json`.

### Tests

```bash
node --experimental-strip-types --test tests/chat-speaker-attribution.test.ts
```

### Acceptance

- Explicit question/answer prefixes are stable.
- Ambiguous `A:` behavior is deterministic.
- Unlabeled lyrics still produce deterministic attribution.
- Low-confidence count is available for QA.

---

## Task 9: Line Timing And Conversation Plan

### Goal

Build production conversation timing from existing timing bundle.

### Implement

- Add `line-timing.ts`.
- Add `conversation-plan.ts`.
- Consume:
  - `lyrics_line_map.json`
  - `speaker_attribution.json`
  - `lyric_word_timing.json`
  - `section_map.json`
  - `beat_grid.json`
- Prefer explicit line ids in word timing when available.
- Otherwise map normalized word sequence to lyric lines in source order.
- Enforce minimum line coverage threshold `0.6`.
- Validate finite `start_sec` / `end_sec`, audio duration bounds, sorted messages, and section ids.
- Diagnostic even-split fallback is allowed only in diagnostic mode.
- Write `conversation_plan.json`.

### Tests

```bash
node --experimental-strip-types --test tests/chat-conversation-plan.test.ts
```

### Acceptance

- Production plan uses timing evidence, not silent fallback.
- Raw/display text matches `lyrics_line_map.json`.
- Speaker assignment matches `speaker_attribution.json`.
- Invalid timing returns stable diagnostics.

---

## Task 10: Chat Animation Plan

### Goal

Turn conversation messages into deterministic chat animation instructions.

### Implement

- Add `chat-animation-plan.ts`.
- Generate `data/chains/chat_dialogue_mv/animation_plan.json`.
- Support only P0 ratio `9:16`.
- Set duration from locked audio duration.
- Build message animation entries with:
  - enter/exit times
  - side
  - motion
  - optional beat accent
- Build scroll windows that cover all messages.
- Ensure minimum visual display time `0.6s`.

### Tests

```bash
node --experimental-strip-types --test tests/chat-animation-plan.test.ts
```

### Acceptance

- Every conversation message appears in animation plan.
- No animation changes message text.
- Scroll windows cover all messages.

---

## Task 11: Chat Frame Contracts And HTML Frames

### Goal

Generate strict chat frame contracts and 9:16 HTML frames.

### Implement

- Add `chat-frame-contracts.ts`.
- Add `chat-frame-html.ts`.
- Write `frame_contracts.json`.
- Generate local-only HTML frames under the html-video project frame directory.
- Use built-in `mobile_dual_chat_default` template.
- Embed only declared JSON/data.
- Keep all resources local and registered.
- Add layout rules for long lyrics:
  - wrapping
  - `overflow-wrap`
  - no negative letter spacing
  - stable top/bottom safe areas
- Reuse or extend existing frame validation to detect:
  - remote resources
  - undeclared paths
  - missing messages
  - duration mismatch
  - fallback frame usage
  - obvious text overflow where smoke checks are available

### Tests

```bash
node --experimental-strip-types --test tests/chat-frame-contracts.test.ts
```

### Acceptance

- Generated frames are local-only.
- Frame contract references all visible messages.
- Production validation fails on remote resources or fallback frame markers.

---

## Task 12: Chain APIs

### Goal

Expose chat dialogue chain operations through project-scoped APIs.

### Implement

Extend `src/server.ts`:

```text
GET  /api/projects/:id/chains
GET  /api/projects/:id/chains/chat-dialogue-mv/status
POST /api/projects/:id/chains/chat-dialogue-mv/run
POST /api/projects/:id/chains/chat-dialogue-mv/build-conversation-plan
POST /api/projects/:id/chains/chat-dialogue-mv/build-frames
GET  /api/projects/:id/chains/chat-dialogue-mv/preview
POST /api/projects/:id/chains/chat-dialogue-mv/revise
POST /api/projects/:id/chains/chat-dialogue-mv/export/render
GET  /api/projects/:id/chains/chat-dialogue-mv/export/final.mp4
```

- `POST /run` delegates to scheduler.
- Manual build endpoints can run a single stage or enqueue it, depending on implementation detail recorded in SPEC notes.
- All routes validate project id and path boundaries.
- All errors return stable JSON diagnostics.

### Tests

```bash
node --experimental-strip-types --test tests/chat-chain-api.test.ts
```

### Acceptance

- Chain status returns input/timing/blocking diagnostics.
- Run endpoint creates a scheduler run.
- Export download reads only `exports/chat_dialogue_mv/final.mp4`.

---

## Task 13: Scheduler APIs

### Goal

Expose scheduler state and run control.

### Implement

Extend `src/server.ts`:

```text
GET  /api/scheduler/status
GET  /api/scheduler/runs
POST /api/scheduler/runs
GET  /api/scheduler/runs/:runId
POST /api/scheduler/runs/:runId/cancel
```

- Accept run request body from SPEC.
- Return run id and initial execution plan summary.
- Provide status summary:
  - ready/running/blocked task count
  - active projects/chains
  - resource locks
  - waiting tasks
- Cancel releases locks and records events.

### Tests

```bash
node --experimental-strip-types --test tests/chat-chain-api.test.ts tests/scheduler-run-queue.test.ts tests/scheduler-recovery.test.ts
```

### Acceptance

- Multi-project run request writes `run_queue.json`.
- Status is readable without starting a live long-running process.
- Cancel is idempotent for already terminal runs.

---

## Task 14: Workbench Scheduler And Chain UI

### Goal

Show scheduler and chat chain state in the existing Workbench page.

### Implement

- Extend `project-status.ts` to include chain summaries.
- Extend `workbench-html.ts` to display:
  - scheduler status
  - ready/running/blocked counts
  - active projects/chains
  - resource locks
  - chat chain input/timing status
  - low-confidence speaker count
  - conversation message count
  - frame validation status
  - preview/export links
- Do not introduce React/Next/Vite.
- Keep page read-only except existing API-triggered actions already supported.

### Tests

```bash
node --experimental-strip-types --test tests/workbench-scheduler-html.test.ts tests/workbench-html.test.ts
```

### Acceptance

- Workbench exposes enough state to understand scheduler progress.
- Existing V3 Workbench tests remain valid.
- No source-code editor, timeline editor, or html-video Studio UI is exposed.

---

## Task 15: Render Export And Manifest v4

### Goal

Export chain-specific final video with full evidence.

### Implement

- Add `render-manifest-v4.ts`.
- Render chat frames to `exports/chat_dialogue_mv/visual.mp4`.
- Mux locked master audio to `exports/chat_dialogue_mv/final.mp4`.
- Validate final mp4:
  - exactly one audio stream
  - duration drift <= 150ms
  - audio source is locked master audio
- Write `exports/chat_dialogue_mv/render_manifest.json`.
- Write `data/chains/chat_dialogue_mv/qa_report.json`.
- Ensure production manifest rejects diagnostic/fallback success.

### Tests

```bash
node --experimental-strip-types --test tests/render-manifest-v4.test.ts
```

### Acceptance

- Manifest schema_version is 4.
- Chain id is `chat_dialogue_mv`.
- Output paths stay under `exports/chat_dialogue_mv/**`.
- Production manifest rejects fallback/diagnostic markers.

---

## Task 16: Chat Dialogue V4 E2E Script

### Goal

Prove one project can complete the chat dialogue chain end to end.

### Implement

- Add `scripts/e2e-chat-dialogue-v4.ts`.
- Build or copy a fixture project with:
  - `lyrics.md`
  - `active_music_take.mp3`
  - timing bundle
- Run chain stages through scheduler or API:
  1. create scheduler run
  2. resolve inputs
  3. build lyrics map
  4. build speaker attribution
  5. build conversation plan
  6. build animation plan
  7. build frames
  8. validate frames
  9. render visual
  10. mux audio
  11. write manifest and QA
- Fail if diagnostic fallback satisfies production success.

### Verification Command

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-chat-dialogue-v4.ts --production
```

### Acceptance

- `exports/chat_dialogue_mv/final.mp4` exists.
- `conversation_plan.json` text traces to `lyrics.md`.
- Manifest and QA report record all evidence.

---

## Task 17: Scheduler V4 E2E Script

### Goal

Prove multi-chain and multi-project scheduling behavior.

### Implement

- Add `scripts/e2e-scheduler-v4.ts`.
- Cover:
  - one project, multiple chains sharing timing bundle
  - multiple projects in one run queue
  - resource locks limiting heavy task concurrency
  - failure isolation
  - resume after interrupted run
- Use mocked or lightweight task executors where live html-video/imagegen would make the scheduler behavior hard to isolate.
- Include a production path variant when local environment supports it.

### Verification Command

```bash
TMPDIR=/tmp \
node --experimental-strip-types scripts/e2e-scheduler-v4.ts --scheduler-smoke
```

### Acceptance

- Timing writer appears once per project.
- Ready queue advances multiple projects fairly.
- Failed project task does not block unrelated project task.
- Resume keeps valid artifacts and requeues incomplete tasks.

---

## Task 18: Focused Verification

### Goal

Keep quality gate narrow and traceable before long E2E runs.

### Required Checks

```bash
TMPDIR=/tmp node --experimental-strip-types --test \
  tests/scheduler-task-model.test.ts \
  tests/scheduler-execution-plan.test.ts \
  tests/scheduler-resource-locks.test.ts \
  tests/scheduler-run-queue.test.ts \
  tests/scheduler-recovery.test.ts \
  tests/scheduler-runner.test.ts \
  tests/chat-lyrics-line-map.test.ts \
  tests/chat-speaker-attribution.test.ts \
  tests/chat-conversation-plan.test.ts \
  tests/chat-animation-plan.test.ts \
  tests/chat-frame-contracts.test.ts \
  tests/chat-frame-renderer.test.ts \
  tests/chat-chain-api.test.ts \
  tests/render-manifest-v4.test.ts \
  tests/workbench-scheduler-html.test.ts
```

```bash
npm run typecheck
```

```bash
TMPDIR=/tmp node --experimental-strip-types --test tests/html-video-*.test.ts
```

### Acceptance

- Focused V4 tests pass.
- Typecheck passes.
- Existing html-video coverage does not regress.

---

## Task 19: Production E2E And Regression

### Goal

Prove V4 end-to-end behavior without weakening V3.

### Required Checks

Chat dialogue production flow:

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-chat-dialogue-v4.ts --production
```

Scheduler smoke:

```bash
TMPDIR=/tmp \
node --experimental-strip-types scripts/e2e-scheduler-v4.ts --scheduler-smoke
```

V3 regression where environment is available:

```bash
TMPDIR=/tmp \
QIVANCE_HTML_VIDEO_RUNTIME_TIMEOUT_MS=600000 \
QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS=900000 \
QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node --experimental-strip-types scripts/e2e-media-v3-regression.ts --all
```

### Acceptance

- V4 chat final MP4 passes media QA.
- Scheduler smoke proves multi-project/multi-chain planning.
- V3 production-strict regression remains passable.

---

## Task 20: TEST_REPORT.v4 And Traceability

### Goal

Record evidence and update project requirements mapping.

### Implement

Create `docs/TEST_REPORT.v4.md` with:

```text
- date, branch, commit
- PRD/SPEC/PLAN references
- focused test commands and results
- typecheck result
- chat dialogue E2E command and artifacts
- scheduler E2E command and artifacts
- render manifest evidence
- scheduler run_queue/resource_locks/event log evidence
- V3 regression result or explicit reason not run
- remaining gaps
```

Update `docs/requirements traceability matrix.md`:

```text
- V4 scheduler requirements
- V4 chat dialogue chain requirements
- evidence paths
- deferred/non-goal items
```

### Acceptance

- Report can be read without inspecting raw logs.
- Traceability matrix distinguishes V3 completed scope from V4 new scope.

---

## Self-Review

Before V4 implementation is considered complete:

- Confirm no DB-backed queue or new database dependency was introduced.
- Confirm no Next.js/React/Vite rewrite was added.
- Confirm diagnostic/fallback runs cannot satisfy production success.
- Confirm chat output never overwrites `exports/final.mp4`.
- Confirm scheduler does not delete or overwrite stale artifacts without explicit user action.
- Confirm scheduler can plan one project with multiple chains and multiple projects in one run.
- Confirm resource locks are released on failed/cancelled tasks.
- Confirm all message text in `conversation_plan.json` traces to `lyrics.md`.
- Confirm final MP4 muxes locked master audio and records ffprobe evidence.
