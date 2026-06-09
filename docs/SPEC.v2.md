# SPEC v2：Qivance Music x html-video 媒体 E2E 加固

> 日期：2026-06-09  
> 状态：Draft  
> 来源 PRD：`docs/qivance_music_html_video_integration_prd.v2.md`  
> 目标：把 V2 PRD 的媒体 E2E 加固范围细化为可实施、可测试、可验收的技术规格。

---

## 1. 范围

V2 只证明真实媒体链路，不建设完整工作台。

核心输入：

```text
active_music_take.mp3
lyrics.md
animation_plan.json
image_generation_plan.json
```

核心输出：

```text
beat_grid.json
onset_events.json
energy_curve.json
lyric_word_timing.json
alignment_report.json
section_map.json
image_assets.json
frames/*.html
visual_silent.mp4
final.mp4
render_manifest.json
TEST_REPORT.v2.md
```

三套 fixture 必须完整真实 E2E：

```text
fixtures/media-e2e-v2/portrait-9x16
fixtures/media-e2e-v2/landscape-16x9
fixtures/media-e2e-v2/square-1x1
```

每套 fixture 使用 20-40 秒真实媒体样本，至少包含 hook / body / outro 三个 section，每套至少一个 scene 启用真实背景图生成。

---

## 2. 非目标

V2 不实现：

```text
- DeepSeek 歌词生成
- MiniMax 音乐生成
- active take 选择
- Obsidian/RAG
- 大项目/小项目完整工作台
- Preview 修改迭代
- 完整审核 UI
- 后台队列
- 自动 retry 系统
- 旧 Qivance Codex runner 主 runtime
- Qivance 自行重复实现 strict duration 动画检测
```

---

## 3. 架构

V2 使用 workflow 函数作为主入口：

```text
runMediaE2EWorkflow(projectId | bundlePath, options)
```

验收脚本：

```text
scripts/e2e-media-v2.ts
```

API 不是 V2 P0 主验收路径。后续 API 只能是 workflow 的薄包装。

### 3.1 模块边界

建议新增或扩展以下边界。具体文件名可在 PLAN 阶段按现有代码结构调整。

```text
media-e2e/
  workflow
  checkpoints
  fixture validation
  TEST_REPORT evidence append

audio-analysis/
  librosa runner
  beat/onset/energy artifact writer
  audio probe metadata

word-alignment/
  WhisperX runner
  lyrics normalization
  fuzzy mapping
  alignment metrics
  alignment override application

section-map/
  lyrics paragraph parser
  section boundary builder
  evidence scoring

image-generation/
  ImageGenerationAdapter interface
  Codex image_gen implementation
  candidate provenance
  lock/reject/skip gate

video-html/
  html-video workspace writer
  agent_context writer
  frame contract writer
  html-video agent/runtime bridge
  frame output validator

export/
  visual render call
  mp3 -> AAC mux
  visual/final ffprobe
  render_manifest writer
```

### 3.2 责任边界

html-video 负责：

```text
- html-video project 结构
- html-video 自带 agent/runtime
- frames/*.html 生成
- visual-only render
- durationMode=explicit / strict duration 行为
- CSS / GSAP / Web Animations 动画时长探测和 auto-extend 控制
```

Qivance 负责：

```text
- fixture bundle 校验
- timing artifacts 生成
- image generation / lock gate
- agent_context / qivance-frame-contracts 写入
- frame 输出验证
- static Preview smoke
- mux locked mp3 as AAC
- ffprobe QA
- render_manifest / TEST_REPORT 证据
```

---

## 4. Fixture Contract

每套 fixture 目录：

```text
fixtures/media-e2e-v2/<ratio>/
  active_music_take.mp3
  lyrics.md
  animation_plan.json
  image_generation_plan.json
```

ratio 取值：

```text
portrait-9x16
landscape-16x9
square-1x1
```

### 4.1 `animation_plan.json`

最低字段：

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "aspect_ratio": "9:16",
  "resolution": { "width": 1080, "height": 1920 },
  "fps": 30,
  "duration_sec": 30.0,
  "scenes": [
    {
      "scene_id": "scene_001_hook",
      "section_ids": ["sec_001_hook"],
      "start_sec": 0.0,
      "end_sec": 8.0,
      "headline": "RAG is not magic",
      "caption_line_ids": ["line_001"],
      "keyword_pop_words": ["RAG"],
      "image_generation": {
        "enabled": true,
        "asset_role": "background",
        "prompt": "high contrast rap classroom, no text",
        "reference_asset_ids": []
      }
    }
  ]
}
```

Validation:

```text
- duration_sec must match active_music_take.mp3 duration within 150ms.
- scenes must be ordered and non-overlapping.
- scene duration must equal end_sec - start_sec within 50ms.
- each fixture must have at least 3 scenes or 3 section mappings.
- each fixture must have at least one image_generation.enabled = true.
- aspect_ratio / resolution must match fixture ratio.
```

### 4.2 `lyrics.md`

`lyrics.md` is the source of truth for words. WhisperX output is evidence only.

Rules:

```text
- V2 must not auto-edit lyrics.md.
- word text in lyric_word_timing.json must come from normalized lyrics.md.
- paragraph boundaries in lyrics.md feed section_map generation.
- repeated choruses must preserve occurrence order.
```

### 4.3 `image_generation_plan.json`

Minimum structure:

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "requests": [
    {
      "request_id": "img_req_scene_001",
      "scene_id": "scene_001_hook",
      "asset_role": "background",
      "prompt": "high contrast rap classroom, no text",
      "reference_asset_ids": [],
      "aspect_ratio": "9:16",
      "target_size": { "width": 1080, "height": 1920 },
      "variants": 2
    }
  ]
}
```

Validation:

```text
- every request.scene_id must exist in animation_plan.json.
- at least one request must exist per fixture.
- target aspect/size must match fixture ratio.
- prompt must explicitly prohibit text in generated image unless the scene requires visible text.
```

---

## 5. Workflow Spec

### 5.1 Options

`runMediaE2EWorkflow` accepts:

```ts
type MediaE2EWorkflowOptions = {
  forceAll?: boolean;
  forceStep?: string[];
  skipPreviewSmoke?: boolean;
  requireGpu?: boolean;
  fixtureRatio?: "portrait-9x16" | "landscape-16x9" | "square-1x1";
  reportPath?: string;
};
```

Default behavior:

```text
- requireGpu = true for full local E2E.
- CPU is allowed only for smoke/diagnostic paths.
- completed checkpoints are reused unless forced.
```

### 5.2 Steps

Workflow steps are ordered and checkpointed:

```text
1. validate_fixture_bundle
2. analyze_audio_with_librosa
3. align_words_with_whisperx
4. build_section_map
5. generate_background_images
6. review_and_lock_image_assets
7. write_html_video_workspace
8. run_html_video_agent_runtime
9. validate_frame_outputs
10. static_preview_smoke
11. render_visual_with_html_video
12. mux_active_mp3_to_final_aac
13. ffprobe_visual_and_final
14. write_render_manifest
15. append_test_report_evidence
```

Checkpoint behavior:

```text
- every step writes started_at, completed_at, status, inputs, outputs, diagnostics.
- failure stops the workflow immediately.
- rerun reuses successful checkpoints.
- --force-step reruns one or more named steps and downstream dependent steps.
- --force-all discards all checkpoints for the run.
```

---

## 6. Audio Analysis Spec

Input:

```text
active_music_take.mp3
```

Implementation:

```text
- use Python + librosa.
- probe duration and sample rate.
- compute tempo/BPM candidates.
- compute beat grid.
- compute onset events.
- compute energy curve.
- detect silence / low-energy hints.
```

Artifacts:

```text
data/timing/beat_grid.json
data/timing/onset_events.json
data/timing/energy_curve.json
```

### 6.1 `beat_grid.json`

Required fields:

```json
{
  "schema_version": 1,
  "duration_sec": 30.0,
  "tempo_bpm": 92.0,
  "tempo_candidates": [92.0],
  "beats": [
    { "index": 0, "time_sec": 0.48, "confidence": 0.8 }
  ]
}
```

### 6.2 `onset_events.json`

Required fields:

```json
{
  "schema_version": 1,
  "duration_sec": 30.0,
  "events": [
    { "time_sec": 0.52, "strength": 0.91 }
  ]
}
```

### 6.3 `energy_curve.json`

Required fields:

```json
{
  "schema_version": 1,
  "duration_sec": 30.0,
  "frame_hop_sec": 0.1,
  "points": [
    { "time_sec": 0.0, "rms": 0.12, "normalized_energy": 0.4 }
  ],
  "low_energy_ranges": [
    { "start_sec": 8.0, "end_sec": 8.4 }
  ]
}
```

Validation:

```text
- artifact duration must match mp3 duration within 150ms.
- beat/onset/energy timestamps must be within audio duration.
- artifacts must record librosa version and Python version in manifest.
```

---

## 7. Word Alignment Spec

Primary backend:

```text
WhisperX
```

Runtime:

```text
- GPU/CUDA required for full local E2E.
- CPU may run smoke/diagnostic only.
- TEST_REPORT.v2 records device, model, compute_type, CUDA/driver environment.
```

Outputs:

```text
data/timing/lyric_word_timing.json
data/timing/alignment_report.json
data/timing/alignment_override.json   # optional, only after automatic alignment fails quality gate
```

### 7.1 Lyrics Normalization

Normalization must:

```text
- preserve lyrics.md as immutable source.
- preserve word occurrence order.
- map punctuation/case/spacing differences.
- preserve paragraph and line ids.
- avoid changing word text in final lyric_word_timing.json.
```

### 7.2 Quality Gate

Automatic alignment must satisfy:

```text
- word coverage >= 85%
- low_confidence_words <= 15%
- unmatched_words <= 10%
- section duration coverage >= 98%
- section boundary evidence drift <= 0.5s
```

If any ratio fails after allowed override, that ratio's full local E2E fails.

### 7.3 `lyric_word_timing.json`

Required fields:

```json
{
  "schema_version": 1,
  "source": "lyrics.md",
  "alignment_backend": "whisperx",
  "duration_sec": 30.0,
  "words": [
    {
      "word_id": "w_000001",
      "paragraph_id": "p_001",
      "line_id": "line_001",
      "text": "RAG",
      "normalized_text": "rag",
      "start_sec": 0.72,
      "end_sec": 1.04,
      "confidence": 0.88,
      "alignment_source": "whisperx"
    }
  ]
}
```

Rules:

```text
- text must come from lyrics.md, not from WhisperX transcript.
- start/end must be monotonic.
- words must not overlap except within 20ms tolerance.
- confidence may be null only if backend does not provide a score; null counts as low confidence for metrics unless override supplies evidence.
```

### 7.4 `alignment_report.json`

Required fields:

```json
{
  "schema_version": 1,
  "backend": "whisperx",
  "model_name": "SPEC_PLAN_DECIDES",
  "align_model": "SPEC_PLAN_DECIDES",
  "device": "cuda",
  "compute_type": "SPEC_PLAN_DECIDES",
  "metrics": {
    "total_words": 120,
    "aligned_words": 108,
    "word_coverage": 0.9,
    "low_confidence_words": 10,
    "low_confidence_ratio": 0.083,
    "unmatched_words": 6,
    "unmatched_ratio": 0.05,
    "section_duration_coverage": 0.99,
    "section_boundary_evidence_drift_sec": 0.32
  },
  "unmatched_words": [],
  "low_confidence_words": []
}
```

### 7.5 `alignment_override.json`

Override policy:

```text
- workflow must run WhisperX + fuzzy mapping first.
- override is allowed only if automatic alignment misses the quality gate.
- override can only patch failed or low-confidence ranges.
- override cannot replace the full WhisperX output.
- override cannot change lyrics.md text or word order.
- manifest records before_metrics and after_metrics.
```

Minimum structure:

```json
{
  "schema_version": 1,
  "override_author": "user_or_agent_id",
  "reason": "low confidence around repeated chorus",
  "created_at": "2026-06-09T00:00:00.000Z",
  "changed_ranges": [
    {
      "range_id": "override_001",
      "word_ids": ["w_000041", "w_000042"],
      "new_start_sec": 10.2,
      "new_end_sec": 10.9
    }
  ]
}
```

---

## 8. Section Map Spec

`section_map.json` is generated from:

```text
lyrics.md paragraph structure
lyric_word_timing.json
beat_grid.json
onset_events.json
energy_curve.json
```

Required fields:

```json
{
  "schema_version": 1,
  "duration_sec": 30.0,
  "sections": [
    {
      "section_id": "sec_001_hook",
      "start_sec": 0.0,
      "end_sec": 8.0,
      "duration_sec": 8.0,
      "lyric_paragraph_ids": ["p_001"],
      "word_range": { "start_word_id": "w_000001", "end_word_id": "w_000024" },
      "beat_range": { "start_index": 0, "end_index": 15 },
      "energy_summary": { "mean": 0.52, "peak": 0.91 },
      "alignment_confidence": 0.86,
      "evidence": {
        "nearest_beat_boundary_drift_sec": 0.12,
        "nearest_onset_boundary_drift_sec": 0.18,
        "energy_boundary_hint": true
      }
    }
  ]
}
```

Validation:

```text
- sections cover >= 98% of audio duration.
- sections are ordered and non-overlapping.
- section boundaries must be within 0.5s of beat/onset/energy evidence where possible.
- each section maps to at least one lyric paragraph or explicit instrumental marker.
- every animation_plan.scene.section_ids entry must exist in section_map.json.
```

---

## 9. Image Generation Spec

V2 uses an abstract adapter:

```ts
type ImageGenerationAdapter = {
  id: string;
  generateImageCandidates(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
};
```

V2 primary implementation:

```text
Codex image_gen adapter
```

The SPEC does not bind a concrete CLI subcommand. The PLAN must choose the actual adapter invocation available in the environment.

### 9.1 Request

```ts
type ImageGenerationRequest = {
  requestId: string;
  sceneId: string;
  assetRole: "background";
  prompt: string;
  referenceAssetIds: string[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetSize: { width: number; height: number };
  variants: number;
  outputDir: string;
};
```

### 9.2 Result

```ts
type ImageGenerationResult = {
  requestId: string;
  adapterId: string;
  status: "succeeded" | "failed";
  candidates: Array<{
    candidateId: string;
    path: string;
    sha256: string;
    width: number;
    height: number;
    provenance: Record<string, unknown>;
  }>;
  diagnostics?: string[];
};
```

### 9.3 Lock Gate

`image_assets.json` contains only locked assets:

```json
{
  "schema_version": 1,
  "small_project_id": "media_e2e_v2_portrait_9x16",
  "assets": [
    {
      "asset_id": "img_scene_001_bg_v001",
      "scene_id": "scene_001_hook",
      "role": "background",
      "path": "assets/images/generated/scene_001_hook_bg_v001.png",
      "sha256": "sha256...",
      "source": "codex_image_gen",
      "status": "locked",
      "prompt": "high contrast rap classroom, no text",
      "created_at": "2026-06-09T00:00:00.000Z"
    }
  ]
}
```

Validation:

```text
- each fixture must lock at least one generated background image.
- frame HTML may only reference locked local image assets.
- frame HTML must not reference external image URLs.
- frame HTML must not reference generated candidates with status rejected/skipped/unlocked.
```

---

## 10. html-video Integration Spec

Qivance writes:

```text
project.json
content-graph.json
qivance-frame-contracts.json
codex/agent_context.json
```

The frame authoring runtime is html-video's own agent/runtime. Qivance provides context and validates outputs.

### 10.1 Agent Context

`agent_context.json` must include:

```text
- lyrics path and normalized lyrics metadata
- timing artifact paths
- beat/onset/energy summaries
- section_map path
- animation_plan path
- image_assets path
- locked image asset list
- strict duration contract
- allowed write paths
```

### 10.2 Frame Contract

`qivance-frame-contracts.json` must include per frame:

```text
- graph node id
- scene id
- section id
- start/end/duration
- word timing range
- beat range
- locked image asset ids allowed for the scene
- durationPolicy = strict
- allowed output path
```

### 10.3 Frame Output Validation

Validation must check:

```text
- expected frame count exists.
- frame metadata matches graph node / scene / duration.
- no frame changes upstream bundle files.
- no external image URLs.
- no unlocked local image references.
- every scene requiring a locked background image uses one.
```

---

## 11. Preview Smoke Spec

V2 only requires static Preview smoke.

Required:

```text
- preview model can read project.json, content-graph.json, qivance-frame-contracts.json, frames.
- static frame serving rejects path traversal.
- optional browser smoke can open each frame and detect nonblank DOM/body.
```

Not required:

```text
- revise endpoint
- user edit loop
- Preview editing UI
- agent run history UI
```

---

## 12. Render And Mux Spec

### 12.1 Strict Duration

Responsibility:

```text
- html-video owns strict duration behavior.
- Qivance does not reimplement CSS/GSAP/Web Animations duration detection.
- Qivance passes explicit frame durations and verifies rendered output.
```

Validation:

```text
- requested duration is recorded per frame.
- html-video render config uses explicit duration semantics.
- visual_silent.mp4 duration drift <= 150ms from expected visual duration.
- final.mp4 duration drift <= 150ms from active_music_take.mp3 duration.
```

### 12.2 Mux

Input:

```text
exports/visual_silent.mp4
audio/master/active_music_take.mp3
```

Output:

```text
exports/final.mp4
```

Mux command semantics:

```text
- map 0:v:0
- map 1:a:0
- c:v copy
- c:a aac
- b:a 192k
- movflags +faststart
```

QA:

```text
- source audio codec = mp3.
- final audio codec = aac.
- final audio stream count = 1.
- final video stream count >= 1.
- final resolution/fps/aspect ratio match animation_plan.json.
- final duration drift <= 150ms.
```

---

## 13. render_manifest Spec

`render_manifest.json` is the machine-readable source of E2E truth.

Required top-level fields:

```json
{
  "schema_version": 2,
  "project_id": "media_e2e_v2_portrait_9x16",
  "aspect_ratio": "9:16",
  "resolution": { "width": 1080, "height": 1920 },
  "fps": 30,
  "workflow_run_id": "run_...",
  "status": "passed",
  "steps": [],
  "inputs": {},
  "audio_analysis": {},
  "word_alignment": {},
  "image_generation": {},
  "html_video": {},
  "render": {},
  "mux": {},
  "qa": {},
  "diagnostics": []
}
```

Must record:

```text
- all input artifact paths + sha256
- active_music_take.mp3 ffprobe
- lyrics.md sha256
- librosa metadata
- WhisperX metadata
- word-level timing metrics
- alignment_report sha256
- alignment_override sha256 if used
- image generation adapter id
- image generation request/response/provenance
- locked image assets
- html-video agent/runtime metadata
- frame list + sha256
- frame local image reference validation
- render config including explicit duration semantics
- visual ffprobe
- mux command metadata
- final ffprobe
- AAC audio proof
- stream count checks
- duration drift checks
- pass/fail diagnostics
```

---

## 14. E2E And CI

### 14.1 Local Full E2E

V2 is complete only when all pass:

```text
scripts/e2e-media-v2.ts --fixture portrait-9x16
scripts/e2e-media-v2.ts --fixture landscape-16x9
scripts/e2e-media-v2.ts --fixture square-1x1
```

Hard requirements:

```text
- GPU available for WhisperX.
- Codex image_gen path available.
- html-video agent/runtime available.
- html-video render available.
- ffmpeg and ffprobe available.
- every fixture writes passing render_manifest.json.
- TEST_REPORT.v2.md summarizes all three manifests.
```

### 14.2 CI

CI does not need real media E2E. CI must cover:

```text
- typecheck
- unit tests
- fixture schema validation
- mock librosa/audio analysis parser
- mock WhisperX parser and quality gate
- alignment override validator
- mock image generation adapter
- image lock gate
- frame reference validator
- manifest writer/validator
- ffprobe parser
```

---

## 15. Follow-Up Details For PLAN

PLAN must decide:

```text
- exact WhisperX model size.
- exact WhisperX compute_type.
- actual Codex image_gen adapter invocation.
- exact JSON schema files and validators.
- fixture themes and source media.
- whether to add schema tests before workflow code.
```

These are implementation choices, not PRD blockers.

