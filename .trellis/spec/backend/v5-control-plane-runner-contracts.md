# V5 Control Plane And Runner Contracts

## Scenario: V5 Product Entry, SQLite Control Plane, Server Runner, And V6 video_chain

### 1. Scope / Trigger

- Trigger: V5 adds DB-backed project creation, input upload/confirmation, scheduler run/task/event persistence, server-owned task execution, timing pipeline, Workbench controls, and render/export evidence. V6 extends the same control plane with `video_chain` for MP4-background html-video previews and explicit final export.
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
  - `GET /projects/:id/video-chain`
  - `GET /projects/:id/video-chain/preview`
- V6 video_chain routes:
  - `GET /api/projects/:id/chains/video-chain/preview`
  - `POST /api/projects/:id/chains/video-chain/revise`
  - `POST /api/projects/:id/chains/video-chain/export/render`
  - `GET /api/projects/:id/chains/video-chain/export/final.mp4`
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
  - `content_type` or `contentType`: required string, enabled values are `chat_dialogue_mv` and `video_chain`
  - `description`: optional string
- Project creation must create project directories and a `Chain` row, but must not create a `SchedulerRun`.
- `POST /api/projects/:id/inputs` accepts multipart fields:
  - `lyrics_text`: optional non-empty text
  - `lyrics_file`: optional `.md` or `.txt`
  - `audio_file`: optional `.mp3` or `.wav`
  - `video_file` or `mp4_file`: optional `.mp4`, required before confirming `video_chain`
  - `replace=true`: required when replacing an existing active input
- Input bytes stay on disk under `inputs/**`; DB rows store metadata, project-relative paths, sha256, mime, kind, and status only.
- `POST /api/projects/:id/inputs/confirm` requires the chain registry's active inputs. `chat_dialogue_mv` requires lyrics/audio. `video_chain` requires lyrics/audio/video, materializes `lyrics.md`, `active_music_take.mp3`, and `source_video.mp4`, then writes `data/source/source_video_import.json` with `audio_policy: background_video_only`.
- `video_chain` uses MP3 as final/master audio. Uploaded MP4 is visual-only background video; its audio stream is ignored and may be absent.
- `video_chain` scheduler stages are `run_timing_pipeline`, `prepare_video_context`, `build_video_frames`, `render_video_visual`, `mux_video_final`, `video_qa_report`, and `write_video_manifest`.
- V5 task outputs stay in:
  - `data/timing/**`
  - `data/chains/chat_dialogue_mv/**`
  - `data/chains/video_chain/**`
  - `video/html-video/.html-video/projects/<project_id>/frames/**`
  - `exports/chat_dialogue_mv/**`
  - `exports/video_chain/**`
- `chat_dialogue_mv` conversation plan build may read optional `data/chains/chat_dialogue_mv/chat_ui_profile.json` to override the single visible header/contact profile before rendering; message rows must not gain visible side names from this profile.
- Final manifest must verify stable input file sha256 against active `ProjectInput` rows before marking the project passed.
- `POST /api/projects/:id/chains/video-chain/revise` runs the html-video agent and refreshes preview frames only. It must not render, mux, create, or modify `final.mp4`.
- `POST /api/projects/:id/chains/video-chain/export/render` is the explicit final export path; it renders html-video frames, muxes `active_music_take.mp3`, writes QA, and writes schema version `6` render manifest.
- `video_chain` frame validation must require every frame to reference the locked background MP4 path from `source_video_import.json`.
- Runtime env keys:
  - `QIVANCE_PROJECTS_ROOT`: storage root override
  - `QIVANCE_V5_RUNNER=0`: disables server runner for tests
  - `QIVANCE_V5_RUNNER_INTERVAL_MS`: runner interval override
  - `QIVANCE_WHISPERX_DEVICE`: `cuda` or `cpu`
  - `QIVANCE_WHISPERX_REQUIRE_GPU`: `0` disables GPU requirement
  - `QIVANCE_WHISPERX_LANGUAGE`: alignment language
  - `QIVANCE_WHISPERX_MODEL`: metadata/model label
  - `QIVANCE_WHISPERX_CACHE_DIR` / `HF_HOME`: alignment cache root; default is repo-local `.cache/huggingface`
  - `QIVANCE_WHISPERX_TIMEOUT_MS`: alignment timeout
  - `NUMBA_CACHE_DIR`, `TORCH_HOME`, `XDG_CACHE_HOME`: default to writable `/tmp` paths in the WhisperX runner if unset

### 4. Validation & Error Matrix

- Missing `title` -> `400 invalid_project_title`
- Missing `content_type` -> `400 invalid_content_type`
- Unknown, disabled, or `image_storyboard_mv` content type -> `400 unsupported_content_type`
- Upload without any supported input field -> `400 invalid_input_upload`
- Unsupported lyrics extension -> `400 unsupported_input_type`
- Unsupported audio extension -> `400 unsupported_input_type`
- Unsupported video extension -> `400 unsupported_input_type`
- Replacing active input without `replace=true` -> `409 input_replacement_required`
- Replacing while project status is `input_confirmed`, `queued`, `running`, or `stopping` -> `409 input_replacement_forbidden`
- Confirm without active lyrics and audio -> `409 inputs_incomplete`
- Confirm `video_chain` without active lyrics, audio, and video -> `409 inputs_incomplete`
- Confirm while a queued/running/stopping run exists -> `409 active_run_exists`
- `video_chain` revision that removes locked background video from any frame -> `409 video_chain_preview_invalid`
- Missing run in stop route -> `404 run_not_found`
- Missing local timing dependency, unavailable model cache, DNS/network model download failure, GPU requirement failure, or missing Python package -> task `blocked` with `timing_blocked:*`
- Audio/timing quality failure after dependencies ran -> task `failed` with `timing_failed:*`
- Locked stable input sha mismatch during manifest -> task/run/project `failed` with `artifact_inconsistent:*`

### 5. Good/Base/Bad Cases

- Good: create `chat_dialogue_mv`, upload lyrics/audio, confirm inputs, server runner produces six timing artifacts, chat JSON/HTML, visual MP4, final MP4, QA report, render manifest, DB artifact rows, and project status `passed`.
- Good: create `video_chain`, upload lyrics/audio/MP4, confirm inputs, server runner produces timing artifacts, background-video html-video frames, visual MP4, MP3-muxed final MP4, QA report, schema v6 render manifest, DB artifact rows, and project status `passed`.
- Base: create project and partial upload leaves project `input_required`; no scheduler run starts before explicit confirmation.
- Base: `QIVANCE_V5_RUNNER=0` leaves confirmed runs queued for API tests.
- Bad: use deterministic or diagnostic timing fallback to mark V5 production success.
- Bad: write audio/video/blob bytes into SQLite.
- Bad: let `image_storyboard_mv` execute as a V5/V6 chain.
- Bad: let a video_chain LLM revision automatically rerender or remux `final.mp4`.
- Bad: accept a video_chain preview frame that omits the locked background MP4.
- Bad: assume WhisperX word timing always has a `word` field; current script writes `text`, and code must accept either `word` or `text`.
- Bad: assume chat lyric timing can match only whitespace-delimited words. Chinese lyrics without spaces must match WhisperX chunks by normalized token/character sequence.

### 6. Tests Required

- Control plane:
  - `tests/prisma-control-plane.test.ts`
  - assert DB path is `qivance_control.sqlite` and rows store metadata only
- Registry/project/input:
  - `tests/chain-registry-v5.test.ts`
  - `tests/project-create-v5.test.ts`
  - `tests/project-inputs-v5.test.ts`
  - assert no run before confirm, replacement rules, and video_chain's MP4 requirement
- Runner/timing/chat:
  - `tests/server-runner-loop-v5.test.ts`
  - `tests/timing-pipeline-v5.test.ts`
  - `tests/chat-dialogue-runner-v5.test.ts`
  - `tests/chat-conversation-plan.test.ts`
    - assert `chat_ui_profile.json` present/absent behavior for project-local contact profile
  - assert stop/recovery, `timing_blocked`, final artifacts, `artifact_inconsistent`, and Chinese no-whitespace lyric chunk matching
- Workbench/API:
  - `tests/workbench-html.test.ts`
  - `tests/workbench-v5-api.test.ts`
  - `tests/workbench-api.test.ts`
  - API tests require local `127.0.0.1` listener permission
- V6 video_chain:
  - `tests/source-video-import.test.ts`
  - `tests/video-chain-runner.test.ts`
  - assert MP4 background policy, html-video preview frame contracts, no source video audio dependency, MP3 final audio mux, and schema v6 manifest
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
- Treat video_chain revision as an export action that regenerates `final.mp4`.
- Validate video references only when present, without requiring the locked background MP4 in every video_chain frame.

#### Correct

- Create only `Project` and `Chain` rows during project creation.
- Store uploaded files under `inputs/**`, materialize stable paths only on confirm, and keep sha metadata in DB.
- Run real audio analysis and WhisperX alignment; classify missing local dependencies as `timing_blocked`.
- Normalize word timing with `word ?? text ?? ""`.
- Require explicit `replace=true`, supersede old inputs, and mark current artifacts stale outside active-run statuses.
- Keep run, project, and chain statuses synchronized through `updateV5RunTerminalStatus`.
- Keep video_chain revision preview-only; final MP4 export happens only through `/chains/video-chain/export/render`.
- Require the locked background MP4 path in every video_chain html-video frame and ignore MP4 audio in favor of `active_music_take.mp3`.
