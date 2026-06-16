# SPEC v3：Qivance Music x html-video 生产工作台闭环

> 日期：2026-06-12
> 状态：Implemented and verified
> 来源 PRD：`docs/qivance_music_html_video_integration_prd.v3.md`
> 目标：把 V3 PRD 的基础 Workbench、文件模型 API、图片规划 / prompt / review、已有 MP4 路径、AI-authored frame authoring 和 production-strict 验收细化为可实施、可测试的技术规格。

---

## 1. 范围

V3 建在 V2 媒体 E2E 能力之上，不重做上游内容生产。V3 P0 只处理已有项目或 fixture，并提供一个基础 Qivance Workbench 页面和配套 API，完成生产用户可操作的闭环。

V3 P0 覆盖：

```text
- 打开已有项目 / fixture
- 聚合文件模型状态
- 基础 Workbench 页面
- Animation Plan 确认
- 基于 section_map 推荐图片时间表
- 小项目级图片组 style + 每图 scene prompt
- 图片候选生成 / accept / reject / skip / regenerate
- 已有本地 MP4 → locked local video asset → html-video frame → render/export
- html-video agent runtime production authoring
- Qivance Preview
- 一条自然语言 revision
- render/export final.mp4
- 主比例完整产品化验收
- 三比例 production-strict media/export 回归
```

V3 P0 不覆盖：

```text
- 新建项目向导或文件上传入口
- 远程 MP4 URL 导入
- 自动解析已有 MP4 的完整语义并重建 storyboard
- DeepSeek / MiniMax / Obsidian / RAG / source capsule / active take 选择
- LLM API 辅助生成或改写图片提示词
- 数据库迁移
- Next.js / React / Vite 重写
- OpenDesign 最终视觉实现
- html-video Studio 生产暴露
- 元素点选、源码编辑、时间线编辑、模板编辑器
```

---

## 2. 架构

### 2.1 模块边界

V3 维持现有 Node 服务作为 Workbench 和 API 承载层：

```text
src/server.ts
  Workbench HTML routes
  V3 project APIs

src/lib/project-core/
  project path resolution
  file existence and artifact discovery

src/lib/workbench/
  project status aggregator
  Workbench HTML rendering helpers
  request body parsing and API response helpers

src/lib/image-generation/
  V2 adapter boundary
  image schedule and prompt group helpers
  image review decisions

src/lib/video-html/
  html-video workspace
  agent runtime
  frame validation
  preview model
  source video asset context

src/lib/export/
  render manifest
  mux / ffprobe / final MP4 evidence
```

The exact module names can change in implementation, but responsibility boundaries must remain the same.

### 2.2 File Model Authority

`projects/<small_project_id>/...` remains the authoritative state model. API responses are views over project files; pages must not encode directory traversal or file naming rules.

No database table is introduced in V3. Any future database migration must preserve the V3 API semantics.

### 2.3 Workbench Modes

V3 has two production input modes:

```text
image_music_mode:
  active_music_take.mp3
  lyrics.md
  animation_plan.json
  image_generation_plan.json

source_video_mode:
  source_video.mp4
  animation_plan.json
```

`image_music_mode` uses the V2 image generation and active music take pipeline. `source_video_mode` uses a locked local source MP4 as the primary visual/audio asset and must preserve the source MP4 original audio.

---

## 3. Project Layout

V3 project roots continue under `projects/<small_project_id>/`.

Required or generated V3 files:

```text
projects/<id>/
  active_music_take.mp3                         # image_music_mode
  lyrics.md                                     # image_music_mode
  animation_plan.json
  image_generation_plan.json                    # image_music_mode
  source_video.mp4                              # source_video_mode

  project_status.json                           # optional persisted cache
  workflow_checkpoints.json
  revision_request.json

  data/
    timing/
      beat_grid.json
      onset_events.json
      energy_curve.json
      lyric_word_timing.json
      alignment_report.json
    storyboard/
      section_map.json
      image_generation_schedule.json
      image_prompt_group.json
      image_assets.json
      image_review_decisions.json
    source/
      source_video_import.json

  video/html-video/.html-video/projects/<id>/
    project.json
    content-graph.json
    qivance-frame-contracts.json
    codex/agent_context.json
    frames/*.html
    agent_runs/*.json

  exports/
    visual_silent.mp4
    final.mp4
    render_manifest.json
```

Implementation may initially keep `agent_runs/*.json` under an existing html-video `codex/` or `qa/` directory if the current runtime already writes there, but the API must expose it as agent run history.

---

## 4. Project Status API Model

`GET /api/projects/:id/status` returns a normalized project status object.

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "mode": "image_music_mode",
  "primary_ratio": "9:16",
  "overall_status": "blocked",
  "blocking_reasons": [
    {
      "code": "animation_plan_unapproved",
      "message": "Animation Plan must be approved before image generation."
    }
  ],
  "inputs": {
    "active_music_take": { "exists": true, "path": "active_music_take.mp3" },
    "lyrics": { "exists": true, "path": "lyrics.md" },
    "animation_plan": { "exists": true, "approved": false },
    "image_generation_plan": { "exists": true, "path": "image_generation_plan.json" },
    "source_video": { "exists": false }
  },
  "steps": [
    {
      "id": "validate_input",
      "label": "Validate input",
      "status": "passed",
      "artifacts": []
    }
  ],
  "artifacts": [
    {
      "id": "render_manifest",
      "path": "exports/render_manifest.json",
      "exists": true,
      "sha256": "..."
    }
  ],
  "agent_runs": [],
  "export": {
    "final_mp4": { "exists": false, "path": "exports/final.mp4" }
  }
}
```

### 4.1 Status Values

Step statuses:

```text
not_started
ready
running
passed
blocked
failed
diagnostic_only
```

`diagnostic_only` must never be treated as production success.

### 4.2 Input Detection

Mode detection:

```text
source_video_mode:
  source_video.mp4 exists OR data/source/source_video_import.json exists

image_music_mode:
  active_music_take.mp3 exists AND image_generation_plan.json exists

blocked:
  neither mode has required inputs
```

If both modes exist, source_video_mode must be explicit in metadata or API input; otherwise API returns a conflict requiring user selection.

---

## 5. Workbench UI Spec

V3 Workbench is a basic operational page served by the current Node service. It is not the final OpenDesign/Next.js UI.

Required pages:

```text
GET /projects
GET /projects/:id
```

Required sections on project detail:

```text
- project header: id, mode, primary ratio, overall status
- input diagnostics
- workflow step list
- Animation Plan approval block
- image schedule block
- image prompt group block
- image review block
- source MP4 block when applicable
- Preview iframe / scene list
- revision form
- agent run log summary
- render/export block
```

Required UI behavior:

```text
- All mutating actions call V3 APIs, then refresh status.
- Long-running actions may be synchronous in V3 P0, but UI must show running / failed / blocked state in the response.
- UI must show production vs diagnostic state clearly.
- UI must not expose html-video Studio links as production actions.
```

Accessibility and polish are basic: readable layout, visible controls, no marketing hero, no final design system.

---

## 6. API Spec

### 6.1 Project APIs

```text
GET /api/projects
GET /api/projects/:id
GET /api/projects/:id/status
```

`GET /api/projects` returns only filesystem-valid projects or fixtures. It must not create directories.

```json
{
  "projects": [
    {
      "small_project_id": "media_e2e_v2_portrait_9x16",
      "mode": "image_music_mode",
      "status": "ready",
      "project_root": "projects/media_e2e_v2_portrait_9x16"
    }
  ]
}
```

### 6.2 Animation Plan Approval

```text
POST /api/projects/:id/animation-plan/approve
```

Writes approval metadata without changing the plan content.

```json
{
  "approved": true,
  "approved_at": "2026-06-12T00:00:00.000Z",
  "approved_by": "local-user",
  "source": "workbench"
}
```

Approval can be stored in `workflow_checkpoints.json` or a sidecar metadata file. Do not mutate original plan semantics to fake approval.

### 6.3 Image Schedule APIs

```text
GET  /api/projects/:id/images/schedule
POST /api/projects/:id/images/schedule/recommend
POST /api/projects/:id/images/schedule
```

`recommend` reads `section_map.json` and proposes image slots. It may write `image_generation_schedule.json` if requested by API options.

### 6.4 Image Prompt Group APIs

```text
GET  /api/projects/:id/images/prompt-group
POST /api/projects/:id/images/prompt-group
```

Prompt group updates must validate that there is exactly one selected style per project and one prompt entry per scheduled image unless the image is skipped.

### 6.5 Image Review APIs

```text
GET  /api/projects/:id/images
POST /api/projects/:id/images/:assetId/lock
POST /api/projects/:id/images/:assetId/reject
POST /api/projects/:id/images/skip
POST /api/projects/:id/images/run-generation
```

All review actions append or update `image_review_decisions.json`. Locking also updates `image_assets.json`.

### 6.6 Source Video APIs

```text
POST /api/projects/:id/source-video/import
```

Accepts a local path already inside the project root or an existing project-relative `source_video.mp4`. Remote URLs are invalid in production.

### 6.7 html-video APIs

```text
POST /api/projects/:id/html-video/run-agent
POST /api/projects/:id/html-video/revise
GET  /api/projects/:id/html-video/preview
```

Production `run-agent` and `revise` fail on timeout, non-zero exit, forbidden file changes, missing AI-authored frames, or invalid frame output. They must not create fallback frames unless diagnostic mode is explicitly requested.

### 6.8 Export APIs

```text
POST /api/projects/:id/export/render
GET  /api/projects/:id/export/final.mp4
```

`export/render` runs the V3 production render/export path and updates `exports/render_manifest.json`.

---

## 7. Image Schedule Spec

`data/storyboard/image_generation_schedule.json`:

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "source_section_map_sha256": "...",
  "status": "draft",
  "generated_at": "2026-06-12T00:00:00.000Z",
  "items": [
    {
      "image_id": "img_scene_001_001",
      "scene_id": "scene_001_hook",
      "section_ids": ["sec_001_hook"],
      "start_sec": 0,
      "end_sec": 8,
      "asset_role": "background",
      "aspect_ratio": "9:16",
      "target_size": { "width": 1080, "height": 1920 },
      "recommendation_reason": "Scene duration and visual hook require one background.",
      "status": "prompt_pending",
      "skip": false
    }
  ],
  "manual_overrides": []
}
```

Recommendation rules:

```text
- Use section_map.json as the primary source.
- Consider scene count, scene duration, visual change density, and reusable locked assets.
- Recommendations are not mandatory; user edits may change count, timing, scene binding, and skip state.
- Time ranges must stay inside the associated scene / section range.
- Schedule status must be confirmed before production image generation.
```

Allowed schedule statuses:

```text
draft
confirmed
generating
reviewing
complete
blocked
```

---

## 8. Image Prompt Group Spec

`data/storyboard/image_prompt_group.json`:

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "style": {
    "style_id": "high_contrast_cyber_classroom",
    "label": "High contrast cyber classroom",
    "style_prompt": "high contrast cyber classroom, crisp rap education visual language",
    "source": "preset"
  },
  "status": "confirmed",
  "items": [
    {
      "image_id": "img_scene_001_001",
      "scene_id": "scene_001_hook",
      "scene_prompt": "RAG knowledge graph behind a rapper teacher, no text",
      "manual_override": true,
      "generation_constraints": "no readable text, no logos, no watermark",
      "final_prompt": "high contrast cyber classroom, crisp rap education visual language; RAG knowledge graph behind a rapper teacher, no text; no readable text, no logos, no watermark",
      "confirmed": true
    }
  ],
  "provenance": {
    "created_by": "workbench",
    "llm_assisted": false
  }
}
```

Prompt rules:

```text
- Exactly one style is selected per small project.
- Each non-skipped schedule item has one scene prompt.
- Final adapter prompt = style prompt + scene prompt + generation constraints.
- V3 P0 permits manual prompt editing only.
- LLM-assisted prompt generation or rewrite must be recorded as unsupported/deferred.
- Changing style after image generation returns schedule/prompt status to confirmation required.
```

---

## 9. Image Review Spec

`data/storyboard/image_review_decisions.json`:

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "decisions": [
    {
      "decision_id": "decision_img_scene_001_001_v1",
      "image_id": "img_scene_001_001",
      "candidate_path": "assets/images/generated/img_scene_001_001_v1.png",
      "action": "lock",
      "reason": "approved in Workbench",
      "decided_at": "2026-06-12T00:00:00.000Z",
      "decided_by": "local-user"
    }
  ]
}
```

Review actions:

```text
lock
reject
skip
regenerate
```

Locking requirements:

```text
- candidate file exists under the project root
- candidate sha256 and dimensions are known
- prompt and provenance are recorded
- linked schedule item and prompt group item are confirmed
- image_assets.json is updated with status locked
```

Regenerate rules:

```text
- Default regenerate keeps project style unchanged.
- Regenerate may edit only the target image scene prompt.
- Changing style requires reconfirming the whole prompt group and schedule.
```

---

## 10. Source Video Spec

`data/source/source_video_import.json`:

```json
{
  "schema_version": 1,
  "small_project_id": "source_video_demo",
  "source_video": {
    "path": "source_video.mp4",
    "sha256": "...",
    "duration_sec": 24.0,
    "width": 1080,
    "height": 1920,
    "video_codec": "h264",
    "audio_streams": 1,
    "audio_codec": "aac",
    "ffprobe": {}
  },
  "audio_policy": "preserve_source_audio",
  "status": "locked",
  "provenance": {
    "source": "local_file",
    "imported_at": "2026-06-12T00:00:00.000Z"
  }
}
```

Source video rules:

```text
- Production accepts local readable MP4 only.
- Remote URL input is rejected.
- Imported MP4 is treated as a locked local video asset.
- html-video agent context must reference only the locked local video path.
- Frame HTML must not reference unregistered external video sources.
- Source video mode may skip image schedule/prompt/review.
- Render/export must preserve source MP4 audio and record audio source evidence in render_manifest.json.
```

---

## 11. html-video Agent Runtime Spec

Production agent runs must create AI-authored frames.

`agent_runs/<agent_run_id>.json`:

```json
{
  "schema_version": 1,
  "agent_run_id": "agent_run_20260612_001",
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "mode": "production",
  "operation": "run_agent",
  "scope": { "type": "project" },
  "input_artifacts": [
    "content-graph.json",
    "qivance-frame-contracts.json",
    "codex/agent_context.json"
  ],
  "started_at": "2026-06-12T00:00:00.000Z",
  "finished_at": "2026-06-12T00:01:00.000Z",
  "exit_code": 0,
  "timed_out": false,
  "changed_files": ["frames/scene_001_hook.html"],
  "ai_authored_frame_paths": ["frames/scene_001_hook.html"],
  "validation": {
    "passed": true,
    "issues": []
  },
  "diagnostics": []
}
```

Production failure conditions:

```text
- agent timeout
- non-zero or non-clean runtime exit
- missing frame output
- no AI-authored frame path
- forbidden file changes
- frame validation failure
- unlocked image or video reference
- external transient URL reference
- fallback frame creation
```

Diagnostic fallback is allowed only with an explicit diagnostic flag and must produce `mode: "diagnostic"`.

---

## 12. Preview Revision Spec

`revision_request.json`:

```json
{
  "schema_version": 1,
  "revision_id": "revision_20260612_001",
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "scope": {
    "type": "scene",
    "scene_id": "scene_001_hook"
  },
  "request": "Make the opening image feel more like a rap classroom and less like a corporate diagram.",
  "created_at": "2026-06-12T00:00:00.000Z",
  "created_by": "local-user",
  "status": "pending"
}
```

Revision rules:

```text
- Exactly one natural-language request per API call.
- Scope is current scene or whole project.
- Revision uses html-video agent runtime.
- Revision success requires production agent run success and frame validation.
- Revision must refresh Preview model after successful run.
- No element picker, source editor, timeline editor, or visual diff automation in V3 P0.
```

---

## 13. Frame And Asset Validation

V3 extends V2 frame validation with source video awareness.

Frame HTML may reference:

```text
- locked local image assets from image_assets.json
- locked local source video asset from source_video_import.json
- project-local static assets explicitly written by Qivance/html-video
```

Frame HTML must not reference:

```text
- remote image or video URLs
- temporary generated paths outside the project root
- unlocked image candidates
- unregistered local video files
- fallback frames in production mode
```

Validation output must be included in agent run log and render manifest diagnostics.

---

## 14. Render Manifest v3 Additions

V3 keeps V2 render manifest fields and adds workbench / agent / source-video evidence.

Required additions:

```json
{
  "v3": {
    "workbench": {
      "primary_ratio": "9:16",
      "project_mode": "image_music_mode"
    },
    "image_schedule": {
      "path": "data/storyboard/image_generation_schedule.json",
      "sha256": "..."
    },
    "image_prompt_group": {
      "path": "data/storyboard/image_prompt_group.json",
      "sha256": "..."
    },
    "image_review_decisions": {
      "path": "data/storyboard/image_review_decisions.json",
      "sha256": "..."
    },
    "agent_runs": [
      {
        "path": "video/html-video/.html-video/projects/<id>/agent_runs/agent_run_20260612_001.json",
        "sha256": "...",
        "mode": "production",
        "ai_authored_frame_count": 3
      }
    ],
    "source_video": {
      "enabled": false
    },
    "production_evidence": {
      "fallback_frames_used": false,
      "diagnostic_flags_used": []
    }
  }
}
```

For source video mode:

```json
{
  "source_video": {
    "enabled": true,
    "path": "data/source/source_video_import.json",
    "sha256": "...",
    "audio_policy": "preserve_source_audio",
    "final_audio_source": "source_video.mp4"
  }
}
```

---

## 15. E2E And CI

### 15.1 Local Production E2E

V3 production E2E must prove:

```text
- one primary ratio completes full Workbench/API product flow
- production agent run creates AI-authored frames
- no fallback frames are used
- image schedule, prompt group, review decisions, and locked assets are recorded
- Preview revision produces a new production agent run
- render/export succeeds
- TEST_REPORT.v3.md records evidence
```

### 15.2 Three-Ratio Regression

Three-ratio regression must preserve V2 production-strict media/export behavior:

```text
9:16
16:9
1:1
```

It does not need to repeat every Workbench manual action for every ratio, but it must not allow cached/seeded imagegen, fallback frames, missing review decisions, or diagnostic-only mode to count as production success.

### 15.3 CI

CI can use mocked external dependencies:

```text
- project status aggregation tests
- image schedule recommendation tests
- image prompt group validation tests
- image review decision tests
- source video import validation tests
- agent run production/diagnostic gate tests
- frame validator tests for locked video assets
- render manifest v3 tests
- API route tests
- basic Workbench HTML smoke tests
```

Real Codex imagegen, real html-video agent runtime, browser render, ffmpeg, ffprobe, and WhisperX remain local production E2E requirements, not CI requirements.

---

## 16. Follow-Up Details For PLAN

The PLAN must define implementation tasks for:

```text
- Workbench/status file aggregator
- V3 API routes
- image_generation_schedule.json schema and recommendation
- image_prompt_group.json schema and validation
- image review decisions and adapter request wiring
- source_video_import.json and locked local video context
- production agent run gate without fallback
- revision request flow
- render_manifest v3 evidence
- Workbench page
- primary-ratio product E2E script
- TEST_REPORT.v3.md
```
