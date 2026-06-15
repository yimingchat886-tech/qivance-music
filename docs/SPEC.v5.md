# SPEC v5：Qivance Music x html-video 上传入口、SQLite 控制面与内置 Runner

> 日期：2026-06-15
> 状态：Draft
> 来源 PRD：`docs/qivance_music_html_video_integration_prd.v5.md`
> 目标：把 V5 PRD 的两步项目创建、歌词/音频上传、SQLite + Prisma 控制面、server 内置 runner loop、自动 timing pipeline、`chat_dialogue_mv` chain registry 和最小内部 Workbench 细化为可实施、可测试的技术规格。

---

## 1. 范围

V5 建在 V4 已验收的 scheduler、resource locks、`chat_dialogue_mv` 文件合同、链路级 render/export 和 Node-served Workbench 之上。V5 的重点是内部产品入口和持久化控制面，不扩展成 SaaS。

V5 P0 覆盖：

```text
- 两步创建项目：先创建空项目，再上传歌词和音频
- 支持 lyrics_text / lyrics_file 和 audio_file
- 用户确认输入后才创建 scheduler run
- 确认后自动跑 timing pipeline
- 确认后自动跑 chat_dialogue_mv chain
- SQLite + Prisma 控制面
- Project / ProjectInput / Artifact / Chain / SchedulerRun / SchedulerTask / SchedulerEvent
- Server 内置 runner loop
- Graceful stop
- Server 重启后恢复 queued / running-stale run
- 最小内部 Workbench：创建、上传、确认、run/task/event、停止、下载 final MP4
- Chain registry 可扩展，但 P0 只启用 chat_dialogue_mv
```

V5 P0 不覆盖：

```text
- SaaS
- 登录、用户体系、复杂权限
- Cloudflare Access / Tailscale
- DeepSeek 歌词生成
- MiniMax 音乐生成
- 多音频 take 选择
- PDF / Word / 网页 / 视频字幕导入
- OpenDesign / Next.js 重写
- 模板市场、Qivance rap 模板包产品化、resources.zip
- image_storyboard_mv
- video_chain（下一版本再做）
- 分布式 worker / 多机器调度
```

---

## 2. 架构

### 2.1 模块边界

V5 继续使用当前 TypeScript + Node HTTP server。新增职责应靠近以下边界：

```text
prisma/
  schema.prisma
  migrations/**

src/server.ts
  project create route
  input upload route
  confirm inputs route
  graceful stop route
  runner loop lifecycle startup

src/lib/db/
  Prisma client lifecycle
  SQLite datasource resolution
  control-plane repositories

src/lib/project-core/
  DB-backed project creation
  project file layout
  stable input path materialization
  input replacement and stale artifact marking

src/lib/scheduler/
  DB-backed run/task/event persistence
  runner loop
  task claiming and recovery
  graceful stop
  resource locks

src/lib/chain-registry/
  chain registry definitions
  enabled chain filtering
  task plan assembly

src/lib/audio-analysis/
src/lib/word-alignment/
src/lib/chat-dialogue/
  V5 task handlers reusing V2-V4 artifact contracts

src/lib/workbench/
  minimal V5 create/upload/confirm/run status UI
```

Exact file names can change during implementation if existing modules provide a better home, but these responsibility boundaries must remain.

### 2.2 State Authority

SQLite + Prisma is the control plane. Project files remain the artifact source of truth.

```text
DB owns:
  project metadata
  input metadata and sha256
  active/superseded input records
  chain status and metrics
  scheduler run/task/event status
  artifact index and stale/current flags

File system owns:
  lyrics/audio bytes
  timing JSON files
  chat_dialogue_mv JSON contracts
  frame HTML
  visual.mp4
  final.mp4
  render_manifest.json
  qa_report.json
```

The DB must not store audio/video/blob payloads. Existing file-based artifacts remain readable by V2-V4 paths.

### 2.3 Consistency Rules

V5 validates only at upload and final manifest time.

```text
upload:
  validate file type / payload presence
  compute sha256
  write ProjectInput metadata

confirm:
  require lyrics + audio
  lock current active inputs
  materialize stable paths
  create SchedulerRun

final manifest:
  verify locked lyrics/audio sha256 match DB records
  verify final output artifacts exist and match recorded sha256
```

If final validation fails, the run status is `failed` and the failure code is `artifact_inconsistent`.

---

## 3. Data Model

### 3.1 Status Values

Project, chain, run, and task status values must use this shared vocabulary where applicable:

```text
draft
input_required
input_uploaded
input_confirmed
queued
running
stopping
stopped
blocked
failed
passed
```

### 3.2 Prisma Models

The implementation should add Prisma models equivalent to:

```text
Project
- id: String @id
- title: String
- content_type: String
- status: String
- project_root: String
- created_at: DateTime
- updated_at: DateTime

ProjectInput
- id: String @id
- project_id: String
- kind: String              # lyrics | audio
- status: String            # active | superseded
- original_name: String
- path: String              # project-relative immutable input path
- stable_path: String       # project-relative lyrics.md or active_music_take.mp3
- sha256: String
- mime: String
- created_at: DateTime

Artifact
- id: String @id
- project_id: String
- chain_id: String?
- kind: String
- path: String
- sha256: String
- schema_version: String?
- status: String            # current | stale
- created_by_run_id: String?
- created_at: DateTime

Chain
- id: String @id
- project_id: String
- chain_id: String
- status: String
- metrics_json: String?
- last_error: String?
- updated_at: DateTime

SchedulerRun
- id: String @id
- project_id: String
- status: String
- mode: String              # production | diagnostic
- priority: Int
- stop_requested: Boolean
- created_at: DateTime
- updated_at: DateTime

SchedulerTask
- id: String @id
- run_id: String
- project_id: String
- chain_id: String
- stage: String
- status: String
- dependencies_json: String
- resource_requirements_json: String
- input_artifacts_json: String
- output_artifacts_json: String
- last_error: String?
- started_at: DateTime?
- finished_at: DateTime?

SchedulerEvent
- id: String @id
- run_id: String?
- task_id: String?
- event_type: String
- message: String
- details_json: String?
- created_at: DateTime
```

Relations and indexes should support:

```text
- project -> inputs
- project -> artifacts
- project -> chains
- project -> runs
- run -> tasks
- run/task -> events
- lookup queued/running/stopping runs by status
- lookup ready tasks by run_id and status
- lookup active inputs by project_id + kind
```

### 3.3 Storage Root

The SQLite file belongs under the configured Qivance storage root, not inside `src/`.

```text
<storageRoot>/qivance_control.sqlite
```

`qivance_audio.sqlite` from older audio asset experiments must not become the V5 control-plane database.

---

## 4. Project File Layout

V5 project roots continue under `projects/<project_id>/`.

```text
projects/<project_id>/
  inputs/
    lyrics/
      lyrics_<timestamp>.md
    audio/
      active_music_take_<timestamp>.mp3

  lyrics.md
  active_music_take.mp3

  data/
    timing/
      beat_grid.json
      onset_events.json
      energy_curve.json
      lyric_word_timing.json
      alignment_report.json
      section_map.json
    chains/
      chat_dialogue_mv/
        lyrics_line_map.json
        speaker_attribution.json
        conversation_plan.json
        animation_plan.json
        frame_contracts.json
        qa_report.json

  video/
    html-video/

  exports/
    chat_dialogue_mv/
      visual.mp4
      final.mp4
      render_manifest.json
```

`lyrics.md` and `active_music_take.mp3` are stable compatibility paths for V2-V4 logic. Immutable uploaded files stay under `inputs/**`.

Input replacement rules:

```text
- default upload cannot overwrite an existing active input
- replace=true is allowed only in draft/input_required/input_uploaded/stopped/failed/passed
- input_confirmed/queued/running/stopping reject replacement
- old input files remain on disk
- old ProjectInput rows become superseded
- downstream Artifact rows become stale
- a new confirm action creates a new SchedulerRun
```

---

## 5. API Spec

### 5.1 Create Project

```text
POST /api/projects
```

Request:

```json
{
  "title": "RAG Rap Lesson",
  "content_type": "chat_dialogue_mv",
  "description": "optional"
}
```

Response:

```json
{
  "project_id": "project_id",
  "status": "input_required",
  "chain_id": "chat_dialogue_mv"
}
```

Behavior:

```text
- create Project row
- create project root
- create Chain row for chat_dialogue_mv
- do not create SchedulerRun
- do not start runner work
```

### 5.2 Upload Inputs

```text
POST /api/projects/:id/inputs
```

Multipart fields:

```text
- lyrics_text
- lyrics_file
- audio_file
- replace=true
```

Behavior:

```text
- accept partial upload
- write immutable files under inputs/**
- compute sha256
- create ProjectInput rows
- update project status to input_uploaded only when active lyrics and audio both exist
- reject unsupported input types
- reject replacement unless replace=true is explicit and status allows it
```

### 5.3 Confirm Inputs

```text
POST /api/projects/:id/inputs/confirm
```

Behavior:

```text
- require active lyrics and audio
- copy or materialize stable lyrics.md and active_music_take.mp3
- update project status to input_confirmed
- create SchedulerRun in queued
- create SchedulerTask rows from chain registry
- emit SchedulerEvent run_created
```

Confirm is idempotent only while no queued/running/stopping run exists. Duplicate confirm during an active run must be rejected.

### 5.4 Graceful Stop

```text
POST /api/projects/:id/runs/:runId/stop
```

Behavior:

```text
- set SchedulerRun.stop_requested = true
- set run status to stopping when applicable
- do not kill the currently executing task
- runner must not start any new task for that run
- unstarted tasks become stopped
- preserve already written artifacts
```

---

## 6. Chain Registry

V5 must introduce a registry abstraction, but P0 enables only `chat_dialogue_mv`.

Required registry entry:

```json
{
  "chain_id": "chat_dialogue_mv",
  "display_name": "Chat Dialogue MV",
  "enabled": true,
  "input_requirements": ["lyrics", "audio"],
  "required_timing": true,
  "stages": [
    "run_timing_pipeline",
    "build_lyrics_line_map",
    "build_speaker_attribution",
    "build_conversation_plan",
    "build_chat_frames",
    "render_visual",
    "mux_final",
    "qa_report",
    "write_manifest"
  ],
  "output_artifacts": [
    "exports/chat_dialogue_mv/final.mp4",
    "exports/chat_dialogue_mv/render_manifest.json"
  ]
}
```

Registry rules:

```text
- unknown chain_id rejects project creation
- disabled chain_id rejects project creation
- image_storyboard_mv must not appear as an enabled or planned V5 chain
- video_chain may be mentioned only as next-version direction, not as a V5 task
```

---

## 7. Server Runner Loop

The Node server starts an internal runner loop after storage root and DB initialization.

Runner responsibilities:

```text
- scan queued runs
- recover running-stale runs after server restart
- claim ready tasks atomically
- respect task dependencies
- acquire resource locks before task execution
- execute task handlers
- write SchedulerTask status transitions
- write SchedulerEvent rows
- write Artifact rows for produced outputs
- stop scheduling new tasks when stop_requested is true
- mark run passed only after final manifest validation
```

Resource names:

```text
audio_analysis
whisperx_alignment
html_video_agent
chromium_render
ffmpeg_mux
image_generation
```

`image_generation` remains a reserved resource type. V5 P0 `chat_dialogue_mv` does not require it in the production happy path.

Task terminal statuses:

```text
passed
failed
stopped
blocked
```

---

## 8. Timing Pipeline

After input confirmation, production mode must run the timing pipeline automatically.

Required timing outputs:

```text
data/timing/beat_grid.json
data/timing/onset_events.json
data/timing/energy_curve.json
data/timing/lyric_word_timing.json
data/timing/alignment_report.json
data/timing/section_map.json
```

Failure codes:

```text
timing_blocked
timing_failed
```

`timing_blocked` means local dependencies are missing or unusable. `timing_failed` means analysis, alignment, or quality gates ran and failed.

Diagnostic fallback may exist for debugging, but it cannot satisfy V5 production acceptance.

---

## 9. Workbench

V5 Workbench remains the current Node-served internal UI. It must support:

```text
- project list
- new project form
- lyrics paste / file upload
- audio upload
- input sha, original filename, mime, and status display
- confirm inputs action
- run list and current run summary
- task table
- event table or event log view
- graceful stop action
- final MP4 download link
- render_manifest.json and qa_report.json links
- timing/render/manifest error display
```

Workbench must not add login, user management, tenant selection, billing, or Cloudflare/Tailscale controls.

---

## 10. Acceptance

V5 P0 is complete when:

```text
- Workbench can create an empty project
- Workbench can upload or paste lyrics
- Workbench can upload mp3/wav audio
- upload records sha256, mime, original filename, and project-relative path
- scheduler does not start before input confirmation
- confirm creates a queued SchedulerRun
- runner loop executes timing pipeline
- runner loop executes chat_dialogue_mv
- final.mp4, render_manifest.json, and qa_report.json are produced
- final manifest validates locked input sha against DB
- running projects reject input replacement
- graceful stop finishes the current task and starts no new task
- stopped projects allow replace=true and a new run
- server restart recovers queued/running-stale runs
- Workbench exposes run/task/event status and failure reason
- image_storyboard_mv is not a V5 enabled chain or future backlog item
- video_chain is recorded only as next-version direction
```
