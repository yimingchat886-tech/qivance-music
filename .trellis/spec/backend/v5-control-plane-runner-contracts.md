# V5 Control Plane And Runner Contracts

## Scenario: V5 Product Entry, SQLite Control Plane, And Server Runner

### 1. Scope / Trigger

- Trigger: V5 adds DB-backed project creation, input upload/confirmation, scheduler run/task/event persistence, server-owned task execution, timing pipeline, Workbench controls, and render/export evidence.
- Applies when changing `src/server.ts`, `prisma/**`, `src/lib/db/**`, `src/lib/project-core/*v5*`, `src/lib/chain-registry/**`, `src/lib/scheduler/*v5*`, `src/lib/scheduler/server-runner-loop.ts`, `src/lib/scheduler/db-run-store.ts`, `src/lib/workbench/**`, `src/lib/word-alignment/**`, or `scripts/e2e-v5-product-entry.ts`.

### 2. Signatures

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/inputs`
- `POST /api/projects/:id/inputs/confirm`
- `POST /api/projects/:id/runs/:runId/stop`
- Workbench routes:
  - `GET /projects`
  - `GET /projects/:id`
- DB file:
  - `<storageRoot>/qivance_control.sqlite`
- Prisma models:
  - `Project`
  - `ProjectInput`
  - `Artifact`
  - `Chain`
  - `SchedulerRun`
  - `SchedulerTask`
  - `SchedulerEvent`
- E2E:
  - `TMPDIR=/tmp node --experimental-strip-types scripts/e2e-v5-product-entry.ts --allow-timing-blocked --timeout-ms 90000`

### 3. Contracts

- `POST /api/projects` accepts JSON:
  - `title`: required string
  - `content_type` or `contentType`: required string, only `chat_dialogue_mv` is enabled in V5 P0
  - `description`: optional string
- Project creation must create project directories and a `Chain` row, but must not create a `SchedulerRun`.
- `POST /api/projects/:id/inputs` accepts multipart fields:
  - `lyrics_text`: optional non-empty text
  - `lyrics_file`: optional `.md` or `.txt`
  - `audio_file`: optional `.mp3` or `.wav`
  - `replace=true`: required when replacing an existing active input
- Input bytes stay on disk under `inputs/**`; DB rows store metadata, project-relative paths, sha256, mime, kind, and status only.
- `POST /api/projects/:id/inputs/confirm` requires active lyrics and audio, materializes `lyrics.md` and `active_music_take.mp3`, then creates one queued production `SchedulerRun` and registry-derived `SchedulerTask` rows.
- V5 task outputs stay in:
  - `data/timing/**`
  - `data/chains/chat_dialogue_mv/**`
  - `video/html-video/.html-video/projects/<project_id>/frames/**`
  - `exports/chat_dialogue_mv/**`
- Final manifest must verify stable input file sha256 against active `ProjectInput` rows before marking the project passed.
- Runtime env keys:
  - `QIVANCE_PROJECTS_ROOT`: storage root override
  - `QIVANCE_V5_RUNNER=0`: disables server runner for tests
  - `QIVANCE_V5_RUNNER_INTERVAL_MS`: runner interval override
  - `QIVANCE_WHISPERX_DEVICE`: `cuda` or `cpu`
  - `QIVANCE_WHISPERX_REQUIRE_GPU`: `0` disables GPU requirement
  - `QIVANCE_WHISPERX_LANGUAGE`: alignment language
  - `QIVANCE_WHISPERX_MODEL`: metadata/model label
  - `QIVANCE_WHISPERX_CACHE_DIR` / `HF_HOME`: alignment cache root
  - `QIVANCE_WHISPERX_TIMEOUT_MS`: alignment timeout
  - `NUMBA_CACHE_DIR`, `TORCH_HOME`, `XDG_CACHE_HOME`: default to writable `/tmp` paths in the WhisperX runner if unset

### 4. Validation & Error Matrix

- Missing `title` -> `400 invalid_project_title`
- Missing `content_type` -> `400 invalid_content_type`
- Unknown, disabled, `image_storyboard_mv`, or `video_chain` content type -> `400 unsupported_content_type`
- Upload without any supported input field -> `400 invalid_input_upload`
- Unsupported lyrics extension -> `400 unsupported_input_type`
- Unsupported audio extension -> `400 unsupported_input_type`
- Replacing active input without `replace=true` -> `409 input_replacement_required`
- Replacing while project status is `input_confirmed`, `queued`, `running`, or `stopping` -> `409 input_replacement_forbidden`
- Confirm without active lyrics and audio -> `409 inputs_incomplete`
- Confirm while a queued/running/stopping run exists -> `409 active_run_exists`
- Missing run in stop route -> `404 run_not_found`
- Missing local timing dependency, unavailable model cache, DNS/network model download failure, GPU requirement failure, or missing Python package -> task `blocked` with `timing_blocked:*`
- Audio/timing quality failure after dependencies ran -> task `failed` with `timing_failed:*`
- Locked stable input sha mismatch during manifest -> task/run/project `failed` with `artifact_inconsistent:*`

### 5. Good/Base/Bad Cases

- Good: create project, upload lyrics/audio, confirm inputs, server runner produces six timing artifacts, chat JSON/HTML, visual MP4, final MP4, QA report, render manifest, DB artifact rows, and project status `passed`.
- Base: create project and partial upload leaves project `input_required`; no scheduler run starts before explicit confirmation.
- Base: `QIVANCE_V5_RUNNER=0` leaves confirmed runs queued for API tests.
- Bad: use deterministic or diagnostic timing fallback to mark V5 production success.
- Bad: write audio/video/blob bytes into SQLite.
- Bad: let `video_chain` or `image_storyboard_mv` execute as V5 P0 chains.
- Bad: assume WhisperX word timing always has a `word` field; current script writes `text`, and code must accept either `word` or `text`.

### 6. Tests Required

- Control plane:
  - `tests/prisma-control-plane.test.ts`
  - assert DB path is `qivance_control.sqlite` and rows store metadata only
- Registry/project/input:
  - `tests/chain-registry-v5.test.ts`
  - `tests/project-create-v5.test.ts`
  - `tests/project-inputs-v5.test.ts`
  - assert no run before confirm and replacement rules
- Runner/timing/chat:
  - `tests/server-runner-loop-v5.test.ts`
  - `tests/timing-pipeline-v5.test.ts`
  - `tests/chat-dialogue-runner-v5.test.ts`
  - `tests/chat-conversation-plan.test.ts`
  - assert stop/recovery, `timing_blocked`, final artifacts, and `artifact_inconsistent`
- Workbench/API:
  - `tests/workbench-html.test.ts`
  - `tests/workbench-v5-api.test.ts`
  - `tests/workbench-api.test.ts`
  - API tests require local `127.0.0.1` listener permission
- E2E:
  - `scripts/e2e-v5-product-entry.ts --allow-timing-blocked --timeout-ms 90000`
  - assert happy path is `passed` when live local dependencies are available; if dependencies are missing, only `timing_blocked` may be accepted as dependency evidence, never as success.

### 7. Wrong vs Correct

#### Wrong

- Create a `SchedulerRun` during `POST /api/projects`.
- Store uploaded audio bytes in SQLite.
- Treat CPU/fixture/deterministic timing fallback as production success.
- Use `word.word.toLowerCase()` directly on WhisperX output.
- Let a replacement upload implicitly overwrite active inputs.
- Update only `SchedulerRun.status` and leave `Project.status`/`Chain.status` stale.

#### Correct

- Create only `Project` and `Chain` rows during project creation.
- Store uploaded files under `inputs/**`, materialize stable paths only on confirm, and keep sha metadata in DB.
- Run real audio analysis and WhisperX alignment; classify missing local dependencies as `timing_blocked`.
- Normalize word timing with `word ?? text ?? ""`.
- Require explicit `replace=true`, supersede old inputs, and mark current artifacts stale outside active-run statuses.
- Keep run, project, and chain statuses synchronized through `updateV5RunTerminalStatus`.
