# SPEC v4：Qivance Music x html-video 问答歌词聊天 MV 与项目调度器

> 日期：2026-06-15
> 状态：Draft
> 来源 PRD：`docs/qivance_music_html_video_integration_prd.v4.md`
> 目标：把 V4 PRD 的 `chat_dialogue_mv_chain`、storage-root 级 scheduler、多项目 / 多链路并行、资源锁、聊天气泡 frame、链路级 render/export 和 production-strict 验收细化为可实施、可测试的技术规格。

---

## 1. 范围

V4 建在 V3 已验收的 file-system Workbench/API/render/export 闭环之上。V4 不引入数据库、不重写前端技术栈、不做上游内容生成。

V4 P0 覆盖：

```text
- storage-root 级 scheduler
- 单项目多链路 execution_plan
- 多项目 run_queue
- resource_locks 控制 WhisperX、html-video agent、Chromium render、ffmpeg、image generation
- chat_dialogue_mv_chain 可用性识别
- lyrics.md 行解析和 raw/display text 映射
- speaker attribution
- line timing 聚合
- conversation_plan.json
- chat animation_plan.json
- chat frame_contracts.json
- 9:16 mobile dual chat HTML frames
- frame validation
- Qivance Preview 接入
- exports/chat_dialogue_mv/visual.mp4
- exports/chat_dialogue_mv/final.mp4
- chain-level render_manifest.json 和 qa_report.json
- scheduler event log、run record、resume/cancel/retry 基础语义
```

V4 P0 不覆盖：

```text
- 新建项目向导或上传入口
- DeepSeek / MiniMax / Obsidian / RAG / active take UI
- LLM 改写歌词或生成新对话
- 多聊天皮肤、群聊、头像生成
- 手动 speaker attribution 或 timeline editor
- 分布式队列、云端 worker、多机器调度
- 数据库型任务队列
- SaaS 权限、登录、计费优先级或租户隔离
- Next.js / React / Vite 重写
```

---

## 2. 架构

### 2.1 模块边界

V4 继续使用当前 Node HTTP 服务和 file-system project model。新增职责应靠近以下边界：

```text
src/server.ts
  chain routes
  scheduler routes
  existing Workbench routes

src/lib/scheduler/
  scheduler config
  execution plan builder
  task model and dependency graph
  run queue
  resource locks
  scheduler event log
  resume/cancel/retry helpers

src/lib/chat-dialogue/
  lyrics line parser
  speaker attribution
  line timing mapper
  conversation plan validator
  chat animation plan builder
  chat frame contracts
  chat HTML frame builder
  chain status and QA report

src/lib/workbench/
  project status aggregator extensions
  chain summary
  scheduler summary for page rendering

src/lib/video-html/
  html-video workspace integration
  frame validation reuse
  preview model reuse

src/lib/export/
  render manifest v4 chain additions
  mux / ffprobe evidence reuse
```

The exact file names can change during implementation if existing modules offer a better home, but these responsibility boundaries must remain.

### 2.2 State Authority

Project files remain authoritative. Scheduler files coordinate execution only; they do not replace project artifacts.

```text
projects/<project_id>/
  lyrics.md
  active_music_take.mp3
  data/timing/**
  data/chains/chat_dialogue_mv/**
  video/html-video/.html-video/projects/<project_id>/**
  exports/chat_dialogue_mv/**

scheduler/
  scheduler_config.json
  run_queue.json
  resource_locks.json
  scheduler_events.jsonl
  project_runs/<run_id>.json
```

If scheduler state and project artifacts disagree, project artifact validation wins. Scheduler must repair its view by rescanning artifacts rather than mutating artifacts blindly.

### 2.3 Runtime Modes

V4 supports:

```text
production:
  no fallback frame success
  no CPU-only WhisperX success
  no diagnostic-only render success
  full manifest and QA evidence required

diagnostic:
  explicit flag required
  may use fallback timing or fallback frames where existing code supports it
  must be marked diagnostic_only
  cannot satisfy V4 production acceptance
```

---

## 3. Project Layout

V4 project roots continue under `projects/<project_id>/`.

Required or generated V4 files:

```text
projects/<id>/
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
        chain_status.json
        lyrics_line_map.json
        speaker_attribution.json
        conversation_plan.json
        animation_plan.json
        frame_contracts.json
        qa_report.json
    scheduler/
      execution_plan.json
      task_events.jsonl

  video/html-video/.html-video/projects/<id>/
    project.json
    content-graph.json
    qivance-frame-contracts.json
    codex/agent_context.json
    frames/*.html
    agent_runs/*.json

  exports/
    chat_dialogue_mv/
      visual.mp4
      final.mp4
      render_manifest.json
```

Compatibility read paths:

```text
timing/*.json
data/storyboard/section_map.json
```

Compatibility paths are read-only inputs for V4 unless the existing V2/V3 workflow already owns writing them.

---

## 4. Scheduler Spec

### 4.1 Scheduler Config

`scheduler/scheduler_config.json`:

```json
{
  "schema_version": 1,
  "project_parallelism": 2,
  "chain_parallelism_per_project": 2,
  "resource_limits": {
    "cpu_light": 4,
    "cpu_heavy": 2,
    "gpu_whisperx": 1,
    "html_video_agent": 1,
    "chromium_render": 2,
    "ffmpeg": 2,
    "image_generation": 1,
    "filesystem_write": 4
  },
  "lock_stale_timeout_sec": 1800,
  "default_priority": 50
}
```

If the file is missing, implementation must use conservative defaults:

```text
project_parallelism = 1
chain_parallelism_per_project = 1
gpu_whisperx = 1
html_video_agent = 1
chromium_render = 1
ffmpeg = 1
image_generation = 1
filesystem_write = 2
```

### 4.2 Run Request

`POST /api/scheduler/runs` accepts:

```json
{
  "project_ids": ["project_a", "project_b"],
  "chains": ["chat_dialogue_mv"],
  "mode": "production",
  "priority": 50,
  "diagnostic_allowed": false,
  "resume": true
}
```

Rules:

```text
- project_ids required and non-empty
- chains required and non-empty
- mode is production or diagnostic
- diagnostic_allowed must be false for production acceptance
- priority only orders ready tasks; it never bypasses dependencies or locks
- resume true reuses valid artifacts and existing non-terminal task state
```

### 4.3 Task Model

Task object:

```json
{
  "task_id": "task_chat_conversation_plan_001",
  "run_id": "run_2026_06_15_001",
  "project_id": "demo_project",
  "chain_id": "chat_dialogue_mv",
  "stage": "build_conversation_plan",
  "status": "ready",
  "priority": 50,
  "dependencies": ["task_resolve_timing_001"],
  "resource_requirements": ["cpu_light", "filesystem_write"],
  "input_paths": ["lyrics.md", "data/timing/lyric_word_timing.json"],
  "output_paths": ["data/chains/chat_dialogue_mv/conversation_plan.json"],
  "input_hashes": {},
  "output_hashes": {},
  "diagnostic_allowed": false,
  "retry_count": 0,
  "last_error": null
}
```

Task statuses:

```text
planned
blocked
ready
running
passed
failed
cancelled
skipped
diagnostic_only
```

Terminal statuses:

```text
passed
failed
cancelled
skipped
diagnostic_only
```

### 4.4 Required Task Stages

V4 P0 scheduler must support:

```text
resolve_project_inputs
resolve_timing_bundle
run_timing_pipeline
build_lyrics_line_map
build_speaker_attribution
build_conversation_plan
build_chain_animation_plan
build_chat_frame_contracts
build_chat_frames
validate_frames
build_preview
render_visual
mux_audio
run_media_qa
write_render_manifest
write_chain_status
```

Resource defaults:

| Stage | Resource requirements |
|---|---|
| resolve_project_inputs | `cpu_light`, `filesystem_write` |
| resolve_timing_bundle | `cpu_light`, `filesystem_write` |
| run_timing_pipeline | `cpu_heavy`, `gpu_whisperx`, `filesystem_write` |
| build_lyrics_line_map | `cpu_light`, `filesystem_write` |
| build_speaker_attribution | `cpu_light`, `filesystem_write` |
| build_conversation_plan | `cpu_light`, `filesystem_write` |
| build_chain_animation_plan | `cpu_light`, `filesystem_write` |
| build_chat_frame_contracts | `cpu_light`, `filesystem_write` |
| build_chat_frames | `html_video_agent`, `filesystem_write` |
| validate_frames | `cpu_light` |
| build_preview | `cpu_light` |
| render_visual | `chromium_render`, `ffmpeg`, `filesystem_write` |
| mux_audio | `ffmpeg`, `filesystem_write` |
| run_media_qa | `ffmpeg` |
| write_render_manifest | `cpu_light`, `filesystem_write` |
| write_chain_status | `cpu_light`, `filesystem_write` |

### 4.5 Execution Plan

`projects/<id>/data/scheduler/execution_plan.json`:

```json
{
  "schema_version": 1,
  "run_id": "run_2026_06_15_001",
  "project_id": "demo_project",
  "chains": ["chat_dialogue_mv"],
  "mode": "production",
  "artifact_snapshot": {
    "lyrics.md": { "exists": true, "sha256": "..." },
    "active_music_take.mp3": { "exists": true, "sha256": "..." }
  },
  "tasks": [],
  "created_at": "2026-06-15T00:00:00.000Z",
  "updated_at": "2026-06-15T00:00:00.000Z"
}
```

Execution plan rules:

```text
- Same project timing writer is unique.
- Shared timing task must precede chain-private timing consumers.
- Existing valid artifacts may mark tasks skipped.
- Stale artifacts do not get overwritten automatically.
- Chain-private render/export paths must remain under exports/<chain_id>/**.
```

### 4.6 Run Queue

`scheduler/run_queue.json`:

```json
{
  "schema_version": 1,
  "runs": [
    {
      "run_id": "run_2026_06_15_001",
      "status": "running",
      "project_ids": ["demo_project"],
      "chains": ["chat_dialogue_mv"],
      "mode": "production",
      "priority": 50,
      "created_at": "2026-06-15T00:00:00.000Z",
      "updated_at": "2026-06-15T00:00:00.000Z"
    }
  ]
}
```

Queue selection:

```text
- only ready tasks are eligible
- dependencies must be terminal passed or skipped
- resource locks must be available
- project-level fair rotation prevents one project from monopolizing all resources
- priority breaks ties within the same fairness bucket
```

### 4.7 Resource Locks

`scheduler/resource_locks.json`:

```json
{
  "schema_version": 1,
  "locks": [
    {
      "resource": "ffmpeg",
      "owner_run_id": "run_2026_06_15_001",
      "owner_task_id": "task_render_visual_001",
      "project_id": "demo_project",
      "chain_id": "chat_dialogue_mv",
      "started_at": "2026-06-15T00:00:00.000Z",
      "stale_after": "2026-06-15T00:30:00.000Z"
    }
  ]
}
```

Lock rules:

```text
- lock count per resource must not exceed scheduler_config resource_limits
- task must acquire all required locks before running
- task must release all locks on passed, failed, cancelled, skipped, or diagnostic_only
- stale locks are not silently ignored; scheduler marks them stale and records an event
- stale lock recovery may release only locks whose owner task is no longer running
```

### 4.8 Event Logs

`scheduler/scheduler_events.jsonl` and project `task_events.jsonl` are append-only.

Event object:

```json
{
  "schema_version": 1,
  "event_id": "evt_001",
  "run_id": "run_2026_06_15_001",
  "project_id": "demo_project",
  "chain_id": "chat_dialogue_mv",
  "task_id": "task_render_visual_001",
  "event_type": "task_started",
  "message": "render_visual acquired chromium_render and ffmpeg",
  "created_at": "2026-06-15T00:00:00.000Z",
  "details": {}
}
```

Required event types:

```text
run_created
execution_plan_written
task_ready
task_blocked
task_started
task_passed
task_failed
task_skipped
task_cancelled
resource_lock_acquired
resource_lock_released
resource_lock_stale
run_completed
run_failed
run_cancelled
```

---

## 5. Chain Status Spec

`data/chains/chat_dialogue_mv/chain_status.json`:

```json
{
  "schema_version": 1,
  "chain_id": "chat_dialogue_mv",
  "status": "conversation_plan_ready",
  "mode": "production",
  "run_id": "run_2026_06_15_001",
  "blocking_reasons": [],
  "artifacts": {
    "lyrics_line_map": {
      "path": "data/chains/chat_dialogue_mv/lyrics_line_map.json",
      "exists": true,
      "sha256": "..."
    }
  },
  "updated_at": "2026-06-15T00:00:00.000Z"
}
```

Status values:

```text
not_started
input_ready
timing_blocked
timing_ready
conversation_plan_ready
frames_ready
preview_ready
rendering
export_ready
failed
diagnostic_only
```

Blocking reason object:

```json
{
  "code": "missing_lyric_word_timing",
  "message": "lyric_word_timing.json is required for production chat timing.",
  "input_artifacts": ["data/timing/lyric_word_timing.json"],
  "retryable": true
}
```

---

## 6. Lyrics Line Map Spec

`lyrics_line_map.json`:

```json
{
  "schema_version": 1,
  "source": {
    "lyrics_path": "lyrics.md",
    "lyrics_sha256": "..."
  },
  "lines": [
    {
      "line_id": "line_001",
      "line_number": 12,
      "line_type": "lyric",
      "raw_text": "问：为什么模型总是乱回答？",
      "display_text": "为什么模型总是乱回答？",
      "prefix": "问：",
      "text_policy": "verbatim_lyrics"
    }
  ],
  "excluded_lines": [
    {
      "line_number": 1,
      "raw_text": "# Song title",
      "reason": "markdown_heading"
    }
  ]
}
```

Parsing rules:

```text
- blank lines are excluded with reason blank_line
- Markdown headings are excluded with reason markdown_heading
- pure section labels like [Verse] are excluded with reason section_label
- lines with role prefix plus lyric text remain lyric lines
- raw_text is the exact source line after newline removal
- display_text may remove only recognized role prefix and surrounding whitespace
- display_text must not be empty for lyric lines
```

Recognized prefixes:

```text
A:
B:
Q:
Question:
Answer:
问：
答：
提问：
回答：
甲：
乙：
```

---

## 7. Speaker Attribution Spec

`speaker_attribution.json`:

```json
{
  "schema_version": 1,
  "source_lyrics_line_map_sha256": "...",
  "speakers": [
    { "id": "questioner", "label": "提问者", "side": "left" },
    { "id": "answerer", "label": "回答者", "side": "right" }
  ],
  "assignments": [
    {
      "line_id": "line_001",
      "speaker": "questioner",
      "side": "left",
      "attribution_source": "explicit_question_prefix",
      "confidence": 1.0
    }
  ],
  "low_confidence_count": 0
}
```

Attribution precedence:

```text
1. A/B/甲/乙 alternating role labels
2. Q/Question/问/提问 => questioner
3. Answer/答/回答 => answerer
4. A: as answer only when nearest explicit Q/Question/问 context exists
5. question punctuation or question words => questioner
6. deterministic alternation from previous speaker
7. first lyric line questioner, next answerer, then alternate
```

Confidence:

```text
explicit role or explicit question/answer prefix: 1.0
question punctuation or question words: 0.8
context alternation: 0.6
default fallback: 0.5
```

Assignments below `0.7` count as low confidence and must appear in `qa_report.json`.

---

## 8. Timing And Conversation Plan Spec

### 8.1 Line Timing

Line timing builder inputs:

```text
lyrics_line_map.json
speaker_attribution.json
data/timing/lyric_word_timing.json
data/timing/section_map.json
data/timing/beat_grid.json
active_music_take.mp3 metadata
```

Production timing rules:

```text
- Prefer explicit line_id if lyric_word_timing contains line references.
- Otherwise map normalized word sequence to lyrics lines in source order.
- start_sec is the first matched word start.
- end_sec is the last matched word end.
- Missing words may be tolerated if line coverage remains above threshold.
- Default minimum line coverage threshold is 0.6.
- start_sec and end_sec must be finite and within audio duration.
- start_sec must be less than end_sec.
- messages must sort by start_sec.
```

Diagnostic fallback:

```text
lyrics line count
→ section duration or total duration even split
→ beat_grid snap with max drift 0.25s
```

Diagnostic fallback must mark chain status `diagnostic_only` unless SPEC is later amended.

### 8.2 Conversation Plan

`conversation_plan.json`:

```json
{
  "schema_version": 1,
  "chain_id": "chat_dialogue_mv",
  "text_policy": "verbatim_lyrics",
  "source": {
    "lyrics_path": "lyrics.md",
    "audio_path": "active_music_take.mp3",
    "lyrics_sha256": "...",
    "audio_sha256": "..."
  },
  "timing": {
    "source": "lyric_word_timing",
    "lyric_word_timing_path": "data/timing/lyric_word_timing.json",
    "section_map_path": "data/timing/section_map.json"
  },
  "speakers": [
    { "id": "questioner", "label": "提问者", "side": "left" },
    { "id": "answerer", "label": "回答者", "side": "right" }
  ],
  "messages": []
}
```

Validation:

```text
- schema_version is 1
- chain_id is chat_dialogue_mv
- text_policy is verbatim_lyrics
- messages are non-empty
- every message has source_line_id
- raw_text matches lyrics_line_map raw_text
- display_text matches lyrics_line_map display_text
- speaker assignment matches speaker_attribution
- section_id exists in section_map
- start_sec/end_sec valid and ordered
- no remote resource references
```

---

## 9. Chat Animation And Frame Contract Spec

### 9.1 Chat Animation Plan

`animation_plan.json`:

```json
{
  "schema_version": 1,
  "chain_id": "chat_dialogue_mv",
  "target_ratio": "9:16",
  "duration_sec": 60.0,
  "template": {
    "id": "mobile_dual_chat_default",
    "variant": "dark_short_video_chat"
  },
  "message_animations": [],
  "scroll_windows": []
}
```

Rules:

```text
- target_ratio is 9:16 in V4 P0
- duration_sec follows locked audio duration
- message enter time equals message start_sec unless beat snap is within 0.25s
- message visual display must last at least 0.6s
- no animation may hide or rewrite message text
- scroll_windows must cover all messages
```

### 9.2 Frame Contracts

`frame_contracts.json`:

```json
{
  "schema_version": 1,
  "chain_id": "chat_dialogue_mv",
  "frames": [
    {
      "frame_id": "chat_dialogue_mv_001",
      "html_path": "video/html-video/.html-video/projects/demo/frames/chat_dialogue_mv_001.html",
      "duration_sec": 8.0,
      "section_ids": ["sec_001"],
      "message_ids": ["msg_001", "msg_002"],
      "text_policy": "verbatim_lyrics",
      "forbidden_remote_resources": true
    }
  ]
}
```

Frame validation must reject:

```text
- remote URL resource references
- undeclared local paths
- runtime text different from conversation_plan display_text
- missing message ids
- duration mismatch
- visible overflow evidence from smoke check where available
- use of fallback frame in production
```

---

## 10. HTML Frame Spec

P0 uses one built-in template: `mobile_dual_chat_default`.

Required characteristics:

```text
- 1080x1920 logical composition for 9:16
- no remote fonts, images, scripts, or styles
- embedded chain JSON or local declared JSON only
- left/right bubble layout
- auto scroll based on animation_plan scroll_windows
- line wrapping for long lyrics
- stable safe area for top and bottom UI chrome
- reduced decorative motion when text density is high
```

Text rendering constraints:

```text
- message text must fit inside bubble width
- long words may break using CSS word-break/overflow-wrap
- font size may use bounded responsive rules but not viewport-only scaling
- no negative letter spacing
- no text over previous or next messages
```

---

## 11. API Spec

### 11.1 Chain APIs

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

`POST /run` delegates to scheduler with one project and chain.

All chain mutations:

```text
- validate project id path boundary
- validate request JSON body
- write chain_status or scheduler task events
- return stable JSON diagnostics
- never write exports/final.mp4
```

### 11.2 Scheduler APIs

```text
GET  /api/scheduler/status
GET  /api/scheduler/runs
POST /api/scheduler/runs
GET  /api/scheduler/runs/:runId
POST /api/scheduler/runs/:runId/cancel
```

Status response:

```json
{
  "schema_version": 1,
  "overall_status": "running",
  "ready_task_count": 3,
  "running_task_count": 1,
  "blocked_task_count": 2,
  "active_projects": ["project_a"],
  "active_chains": ["chat_dialogue_mv"],
  "resource_locks": []
}
```

Error response:

```json
{
  "error": {
    "code": "scheduler_resource_unavailable",
    "message": "ffmpeg resource limit reached.",
    "retryable": true
  }
}
```

---

## 12. Workbench UI Spec

V4 extends the existing Node-served Workbench. It must show:

```text
- scheduler summary: overall status, ready/running/blocked task counts
- active projects and chains
- resource locks and waiting tasks
- per-project chain status
- chat_dialogue_mv input diagnostics
- timing bundle status
- speaker attribution summary and low-confidence count
- conversation_plan message count
- frame validation state
- preview entry
- render/export state
- final.mp4 download
```

Workbench does not need a full scheduler control console in P0. It must expose enough status to understand what is running, blocked, failed, or ready.

---

## 13. Render Manifest v4

`exports/chat_dialogue_mv/render_manifest.json`:

```json
{
  "schema_version": 4,
  "mode": "production",
  "chain": {
    "id": "chat_dialogue_mv",
    "run_id": "run_2026_06_15_001",
    "conversation_plan": {
      "path": "data/chains/chat_dialogue_mv/conversation_plan.json",
      "sha256": "..."
    },
    "frame_contracts": {
      "path": "data/chains/chat_dialogue_mv/frame_contracts.json",
      "sha256": "..."
    }
  },
  "inputs": {
    "lyrics": { "path": "lyrics.md", "sha256": "..." },
    "audio": { "path": "active_music_take.mp3", "sha256": "..." },
    "timing": {}
  },
  "outputs": {
    "visual": { "path": "exports/chat_dialogue_mv/visual.mp4", "sha256": "..." },
    "final": { "path": "exports/chat_dialogue_mv/final.mp4", "sha256": "..." }
  },
  "qa": {
    "ffprobe": {},
    "duration_drift_ms": 0,
    "audio_stream_count": 1
  },
  "production_gates": {
    "fallback_frames_used": false,
    "diagnostic_only": false,
    "remote_resources_used": false
  }
}
```

Validation:

```text
- schema_version is 4
- chain.id is chat_dialogue_mv
- mode production cannot have diagnostic_only true
- final output path must be under exports/chat_dialogue_mv/
- final has exactly one audio stream
- final duration drift from locked audio <= 150ms
- conversation_plan and frame_contracts hashes match files
- fallback_frames_used false for production
```

---

## 14. QA Report Spec

`qa_report.json`:

```json
{
  "schema_version": 1,
  "chain_id": "chat_dialogue_mv",
  "run_id": "run_2026_06_15_001",
  "text_policy": {
    "raw_text_from_lyrics": true,
    "display_text_rewrite_detected": false
  },
  "speaker_attribution": {
    "message_count": 20,
    "low_confidence_count": 2
  },
  "timing": {
    "source": "lyric_word_timing",
    "fallback_used": false
  },
  "frames": {
    "validated": true,
    "overflow_issues": []
  },
  "export": {
    "final_mp4": "exports/chat_dialogue_mv/final.mp4",
    "audio_source": "active_music_take.mp3",
    "duration_drift_ms": 0
  }
}
```

QA report must be readable without opening raw scheduler logs.

---

## 15. E2E And CI

### 15.1 Focused Unit/API Coverage

Required focused tests:

```text
tests/scheduler-task-model.test.ts
tests/scheduler-execution-plan.test.ts
tests/scheduler-resource-locks.test.ts
tests/scheduler-run-queue.test.ts
tests/scheduler-recovery.test.ts
tests/scheduler-runner.test.ts
tests/chat-lyrics-line-map.test.ts
tests/chat-speaker-attribution.test.ts
tests/chat-conversation-plan.test.ts
tests/chat-animation-plan.test.ts
tests/chat-frame-contracts.test.ts
tests/chat-frame-renderer.test.ts
tests/chat-chain-api.test.ts
tests/render-manifest-v4.test.ts
```

### 15.2 Local Production E2E

Local production E2E should prove:

```text
- one project chat_dialogue_mv_chain end to end
- one project with multiple chains sharing timing bundle
- multiple projects in one scheduler run
- failure in one project does not block unrelated project
- resume after interrupted run does not overwrite valid artifacts
```

Suggested scripts:

```text
scripts/e2e-chat-dialogue-v4.ts
scripts/e2e-scheduler-v4.ts
```

### 15.3 CI

CI should run deterministic tests with mocked external dependencies. Live WhisperX, image generation, html-video agent, browser render, ffmpeg, and ffprobe remain local production E2E requirements unless the environment explicitly supports them.

---

## 16. Follow-Up Details For PLAN

PLAN.v4 must sequence implementation so scheduler foundations come before chat chain orchestration:

```text
1. Scheduler schemas and file helpers
2. Execution plan and resource locks
3. Lyrics and conversation contracts
4. Chat frame generation and validation
5. Chain APIs and scheduler APIs
6. Workbench status display
7. Render/export manifest v4
8. E2E scripts, TEST_REPORT.v4, traceability matrix
```
