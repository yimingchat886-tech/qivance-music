# SPEC v6：video_chain、MP4 背景视频、html-video 预览修订与显式导出

> 日期：2026-06-17
> 状态：Draft
> 来源 PRD：`docs/qivance_music_html_video_integration_prd.v6.md`
> 目标：把 V6 PRD 的 `video_chain`、MP4/MP3/lyrics 输入、section map、html-video frame agent、preview-only LLM revision、显式 final export、schema v6 manifest 细化为可实施、可测试的技术规格。

---

## 1. 范围

V6 建在 V5 的 DB-backed control plane、ProjectInput、Chain registry、server runner loop 和 V3/V4 html-video/source-video/render/export 合同之上。

V6 覆盖：

```text
- 启用 video_chain
- 支持 video_chain 项目创建
- 支持 lyrics/audio/video 三类 ProjectInput
- 支持 .mp4 背景视频导入
- MP4 audio policy = background_video_only
- MP3/WAV stable master audio = active_music_take.mp3
- 复用 timing pipeline 生成 section_map
- 生成 video_chain animation plan
- 进入 html-video agent/runtime 生成 frame HTML
- 每个 frame 必须引用锁定 MP4 背景路径
- 子页面 preview iframe
- LLM revision 只刷新 preview
- 显式 final export
- schema v6 render manifest
```

V6 不覆盖：

```text
- SaaS / auth / permissions
- video semantic understanding
- 自动剪辑 MP4
- 从 MP4 提取最终音频
- image_storyboard_mv
- 多 worker / 分布式调度
```

---

## 2. 模块边界

```text
src/lib/chain-registry/chain-registry.ts
  video_chain registry entry, input requirements, task stages, output artifacts

src/lib/project-core/project-create-v5.ts
  video_chain project directory layout

src/lib/project-core/project-inputs-v5.ts
  video_file/mp4_file upload, stable source_video.mp4 materialization, confirm requirements

src/lib/video-html/source-video-import.ts
  background_video_only policy and MP4 probe rules

src/lib/video-chain/video-chain-runner.ts
  video_chain task implementation, html-video context, frame validation, render/mux/QA/manifest

src/lib/scheduler/v5-task-handlers.ts
  map video_chain stages to runner functions

src/lib/scheduler/db-run-store.ts
  synchronize run/project/chain status by run task chain IDs

src/lib/workbench/workbench-html.ts
  video_chain subpage, preview player, revision/export controls

src/server.ts
  video_chain routes, upload routing, preview/revision/export APIs
```

---

## 3. Chain Registry

`video_chain` registry entry:

```text
chain_id: video_chain
input_requirements:
  - lyrics
  - audio
  - video
required_timing: true
```

Stages:

```text
run_timing_pipeline
prepare_video_context
build_video_frames
render_video_visual
mux_video_final
video_qa_report
write_video_manifest
```

Stage outputs:

```text
run_timing_pipeline:
  data/timing/beat_grid.json
  data/timing/onset_events.json
  data/timing/energy_curve.json
  data/timing/lyric_word_timing.json
  data/timing/alignment_report.json
  data/timing/section_map.json

prepare_video_context:
  data/source/source_video_import.json
  data/chains/video_chain/video_animation_plan.json

build_video_frames:
  data/chains/video_chain/frame_contracts.json
  video/html-video/.html-video/projects/<project_id>/agent_runs/<agent_run_id>.json

render_video_visual:
  exports/video_chain/visual.mp4

mux_video_final:
  exports/video_chain/final.mp4

video_qa_report:
  data/chains/video_chain/qa_report.json

write_video_manifest:
  exports/video_chain/render_manifest.json
```

---

## 4. Input Contract

### 4.1 Upload

`POST /api/projects/:id/inputs` accepts:

```text
lyrics_text
lyrics_file: .md | .txt
audio_file: .mp3 | .wav
video_file: .mp4
mp4_file: .mp4
replace=true
```

DB `ProjectInput.kind` values:

```text
lyrics
audio
video
```

Stable paths:

```text
lyrics  -> lyrics.md
audio   -> active_music_take.mp3
video   -> source_video.mp4
```

### 4.2 Confirm

`video_chain` confirm requires active:

```text
lyrics + audio + video
```

Confirm writes:

```text
lyrics.md
active_music_take.mp3
source_video.mp4
data/source/source_video_import.json
```

`source_video_import.json` must record:

```text
audio_policy: background_video_only
source_video.path: source_video.mp4
source_video.sha256
source_video.duration_sec
source_video.width
source_video.height
source_video.video_codec
source_video.audio_streams
source_video.audio_codec
```

MP4 with no audio stream is valid for `background_video_only` if it has a readable video stream and positive duration.

---

## 5. html-video Contract

### 5.1 Animation Plan

`prepare_video_context` builds:

```text
data/chains/video_chain/video_animation_plan.json
```

Plan requirements:

```text
- schemaVersion = 1
- targetDurationSec equals summed section durations
- scenes map to section_map.sections
- scene assets include source_video.mp4
- visual directives require full-frame MP4 background and knowledge-card overlays
```

### 5.2 Agent Context

`build_video_frames` writes:

```text
video/html-video/.html-video/projects/<project_id>/codex/agent_context.json
```

Context must expose:

```text
sourceVideo.enabled = true
sourceVideo.path = source_video.mp4
sourceVideo.audioPolicy = background_video_only
sourceFiles.masterAudio = ../../../active_music_take.mp3
sourceFiles.sectionMap = ../../../data/timing/section_map.json
```

### 5.3 Frame Validation

Frame validation must reject:

```text
- missing frame HTML
- remote image/video URLs
- blob:, data:, file:, http:, https:, and protocol-relative media source URLs
- unregistered local video paths
- forbidden path changes
- missing window.__QIVANCE_FRAME metadata
- duration drift over contract
- any video_chain frame that does not reference source_video.mp4
- source_video.mp4 or source video audio in <audio> elements
- <video> elements with controls or without muted/defaultMuted behavior
- frames without a practical overlay / knowledge-card / callout / keyword marker
```

---

## 6. Revision Contract

```text
POST /api/projects/:id/chains/video-chain/revise
```

Request body follows existing html-video revision shape:

```json
{
  "scope": { "type": "project" },
  "request": "Make cards more energetic and add beat-synced keyword pops."
}
```

Required behavior:

```text
- write revision_request.json
- run html-video revision agent
- persist agent run log
- validate qivance-frame-contracts.json
- validate every frame keeps source_video.mp4
- return preview model
- do not call renderHtmlVideoVisual
- do not call muxLockedAudio
- do not write exports/video_chain/final.mp4
```

Failure behavior:

```text
- invalid request -> 400 invalid_revision_request
- frame/background validation failure -> 409 video_chain_preview_invalid
- agent/runtime failure -> 409 revision_failed
```

---

## 7. Export Contract

```text
POST /api/projects/:id/chains/video-chain/export/render
GET /api/projects/:id/chains/video-chain/export/final.mp4
```

Export behavior:

```text
1. Render html-video frames to exports/video_chain/visual.mp4
2. Mux active_music_take.mp3 into exports/video_chain/final.mp4
3. ffprobe final.mp4 and active_music_take.mp3
4. Require final.mp4 has exactly one audio stream
5. Require duration drift <= 150ms
6. Write data/chains/video_chain/qa_report.json
7. Write exports/video_chain/render_manifest.json
8. Mark old video_chain current artifacts stale and insert current Artifact rows
```

Final audio source is always:

```text
active_music_take.mp3
```

The MP4 background audio must not become final audio.

---

## 8. Render Manifest v6

`exports/video_chain/render_manifest.json`:

```text
schema_version: 6
mode: production
chain.id: video_chain
inputs.lyrics
inputs.audio
inputs.background_video
inputs.background_video.audio_policy: ignore_source_audio
inputs.timing.*
outputs.visual
outputs.final
qa.final_audio_source: active_music_take.mp3
production_gates.html_video_agent_required: true
production_gates.fallback_frames_used: false
production_gates.diagnostic_only: false
production_gates.remote_resources_used: false
qa.final_audio_source: active_music_take.mp3
qa.audio_stream_count: 1
qa.duration_drift_ms <= 150
all EvidenceRef.path values non-empty
all EvidenceRef.sha256 values 64 lowercase hex
```

---

## 9. Workbench Contract

Routes:

```text
GET /projects/:id/video-chain
GET /projects/:id/video-chain/preview
```

Subpage sections:

```text
Inputs
Run Control
html-video Preview
LLM Revision
Export
Artifacts
Task Events
```

The revision client script must refresh:

```text
/projects/:id/video-chain/preview?t=<timestamp>
```

It must not call:

```text
/chains/video-chain/export/render
```

unless the user clicks the explicit export button.

---

## 10. Error Matrix

| Condition | Response / Status |
|---|---|
| Unknown content type | `400 unsupported_content_type` |
| Missing active video for `video_chain` confirm | `409 inputs_incomplete` |
| Unsupported video extension | `400 unsupported_input_type` |
| Empty video upload | `400 invalid_input_upload` |
| Missing run stop target | `404 run_not_found` |
| MP4 import has no video stream | task/API failure |
| MP4 import has no audio stream with `background_video_only` | allowed |
| LLM revision removes background video | `409 video_chain_preview_invalid` |
| Final MP4 audio stream count != 1 | `video_chain_audio_stream_invalid` |
| Final duration drift > 150ms | `video_chain_duration_drift` |
| Stable input sha mismatch during manifest | `artifact_inconsistent` |

---

## 11. Required Tests

```bash
npm run typecheck

TMPDIR=/tmp node --experimental-strip-types --test \
  tests/prisma-control-plane.test.ts \
  tests/chain-registry-v5.test.ts \
  tests/project-create-v5.test.ts \
  tests/project-inputs-v5.test.ts \
  tests/server-runner-loop-v5.test.ts \
  tests/timing-pipeline-v5.test.ts \
  tests/chat-dialogue-runner-v5.test.ts \
  tests/workbench-html.test.ts \
  tests/source-video-import.test.ts \
  tests/video-chain-runner.test.ts

TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-v5-api.test.ts
TMPDIR=/tmp npm test
TMPDIR=/tmp node --experimental-strip-types --test tests/chat-chain-api.test.ts
TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-api.test.ts
TMPDIR=/tmp node --experimental-strip-types --test tests/workbench-scheduler-html.test.ts
git diff --check
```

Network/listener API tests require permission to bind `127.0.0.1`.
