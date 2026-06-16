# Qivance Music x html-video 子 PRD v2：媒体 E2E 加固

> 日期：2026-06-09
> 状态：正式 V2 子 PRD
> 父 PRD：`docs/qivance_music_html_video_integration_prd.md`
> 校准依据：`docs/TEST_REPORT.v1.md`、`docs/requirements traceability matrix.md`
> 版本目标：在 V1 已完成的 html-video 后端边界上，证明三种比例的真实媒体链路可以从锁定输入产出可验收 `final.mp4`。

---

## 1. V2 定位

V2 不做完整内部工作台版，改为 **媒体 E2E 加固版**。

V1 已证明 vendor/submodule 接入、ContentGraph 映射、workspace 写入、frame prompt、Preview API 骨架、strict render wrapper、manifest 与 mux wrapper 的结构可行。V2 要证明这些结构在真实媒体路径下可用，重点是：

```text
active_music_take.mp3
+ lyrics.md
+ animation_plan.json
+ image_generation_plan.json
→ audio/timing analysis
→ background image generation
→ html-video agent/runtime frame authoring
→ html-video visual render
→ Qivance mux locked mp3 as AAC
→ ffprobe QA
→ final.mp4
```

V2 的完成判定以本地真实 E2E 证据为准，不以 mock 测试、schema 存在或结构性代码存在为准。

---

## 2. 已确认决策

| 编号 | 决策项 | 结论 |
|---|---|---|
| D1 | V2 版本形态 | 媒体 E2E 加固版 |
| D2 | 上游业务链路 | 不做 DeepSeek 歌词生成、不做 MiniMax 音乐生成、不做 Obsidian/RAG/完整工作台 |
| D3 | 音频输入 | 使用已锁定 `active_music_take.mp3`，Qivance 只负责 mux，不做音频生成或 take 选择 |
| D4 | 最终音频编码 | `final.mp4` 音频固定转码为 AAC |
| D5 | 背景图生成 | 纳入 V2，作为真实 E2E 步骤 |
| D6 | 背景图审核 | 保留 lock/reject/skip，但只做文件/API 最小闭环，不做完整 UI |
| D7 | E2E 主入口 | 以 workflow 函数为核心，脚本调用 workflow 做本地验收 |
| D8 | 重跑策略 | step checkpoint + 手动重跑；不做后台队列或自动 retry 系统 |
| D9 | 多比例验收 | 9:16、16:9、1:1 三套独立 fixture bundle 都跑完整真实 E2E |
| D10 | CI 边界 | 本地真实 E2E 是硬门槛；CI 只跑 mock/smoke |
| D11 | Preview | 只做 frame 输出验证和静态 Preview smoke，不做用户修改迭代 |
| D12 | strict duration | 责任归 html-video render 层；Qivance V2 只验证和记录，不重复实现检测 |
| D13 | frame agent | 使用 html-video 自带 agent/runtime；Qivance 只提供上下文、文件 gate、输出验证 |
| D14 | timing | V2 增加歌曲解析，从 `mp3 + lyrics.md` 生成 timing artifacts |
| D15 | word-level timing | 主路径选用 WhisperX，librosa 继续负责音乐证据层 |
| D16 | timing 质量门槛 | 中等严格，可用于视频生产，不追求逐词完美 |
| D17 | 歌词权威性 | 保留 `lyrics.md`，并以 `lyrics.md` 为准；WhisperX/ASR 不得自动改写歌词 |
| D18 | timing override | 允许人工 `alignment_override.json` 修正 timing，不允许修改歌词文本 |
| D19 | 三比例生图 | 三套 fixture 都必须至少一个 scene 启用真实背景图生成 |
| D20 | image generation adapter | 抽象 adapter 接口，Codex image_gen 作为 V2 主实现 |
| D21 | E2E 证据 | `render_manifest.json` 是机器可读主证据；`TEST_REPORT.v2.md` 是人工总结 |

---

## 3. 输入与输出

每套比例 fixture 至少包含：

```text
fixtures/media-e2e-v2/<ratio>/
  active_music_take.mp3
  lyrics.md
  animation_plan.json
  image_generation_plan.json
```

输入约束：

```text
- active_music_take.mp3 是已锁定主音频。
- lyrics.md 是已锁定歌词文本，不由 V2 生成。
- animation_plan.json 是已确认视频制作计划，不由 V2 生成。
- image_generation_plan.json 每套 fixture 都必须包含，且至少一个 scene 启用真实背景图生成。
- section_map.json、beat_grid.json、lyric_word_timing.json 不作为手写输入，由 V2 歌曲解析链路生成。
```

每套比例 E2E 必须产出：

```text
projects/media_e2e_v2_<ratio>/
  data/timing/beat_grid.json
  data/timing/onset_events.json
  data/timing/energy_curve.json
  data/timing/lyric_word_timing.json
  data/timing/alignment_report.json
  data/timing/alignment_override.json        # 仅在使用人工 timing override 时存在
  data/storyboard/section_map.json
  data/storyboard/image_assets.json
  assets/images/generated/
  video/html-video/.html-video/projects/<project_id>/frames/*.html
  exports/visual_silent.mp4
  exports/final.mp4
  exports/render_manifest.json
```

V2 总体验收还必须产出：

```text
docs/TEST_REPORT.v2.md
```

---

## 4. 责任边界

html-video 负责：

```text
- html-video project 结构
- html-video 自带 agent/runtime
- frame HTML 生成
- 模板/renderer 可消费的项目结构
- visual-only render
- render 层 durationMode=explicit / strict duration 行为
- CSS / GSAP / Web Animations 等动画时长探测和 auto-extend 控制
```

Qivance V2 负责：

```text
- 准备并校验媒体 E2E fixture bundle
- 从 active_music_take.mp3 + lyrics.md 生成 timing artifacts
- 背景图生成、候选图 provenance、lock/reject/skip gate
- 写入 image_assets.json，且只允许 locked 本地图片进入视频制作
- 生成 agent_context.json 和 qivance-frame-contracts.json
- 向 html-video agent/runtime 提供权威上下文
- 校验 frame 输出数量、metadata、duration contract、本地图片引用
- 静态 Preview smoke
- 调用 html-video visual render
- 将 active_music_take.mp3 mux 进 final.mp4，并转码为 AAC
- ffprobe visual/final 输出
- 写 render_manifest.json
- 写 TEST_REPORT.v2.md
```

明确不做：

```text
- 不做 DeepSeek 歌词生成
- 不做 MiniMax 音乐生成
- 不做 active take 选择
- 不做 Obsidian/RAG
- 不做大项目/小项目完整工作台
- 不做 Preview 修改迭代
- 不做完整审核 UI
- 不做后台任务队列或自动 retry 系统
- 不恢复旧 Qivance 自建 Codex runner 作为主 runtime
- 不让 frame agent 在 html-video 制作阶段临时生图
- 不让 frame agent 引用未 locked 图片或外链图片
- 不让 frame agent 修改 upstream artifact bundle、audio、timing、image_assets
- 不由 Qivance V2 重复实现 strict duration 动画检测
```

---

## 5. Workflow

V2 核心入口：

```text
runMediaE2EWorkflow(projectId | bundlePath, options)
```

验收脚本：

```text
scripts/e2e-media-v2.ts
```

API 不是 V2 P0 主验收路径。后续如需要 API，只作为 workflow 的薄包装。

Workflow steps：

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

Checkpoint and rerun：

```text
- 每个 step 写 checkpoint 和 task log。
- 失败即停。
- 默认复用已通过 checkpoint 的产物。
- 已 locked 的 image_assets 默认复用。
- 已生成 frames 默认复用，除非强制重跑 agent step。
- 已渲染 visual/final 默认复用，除非强制重跑 render/mux/qa step。
- 支持 --force-step <name>。
- 支持 --force-all。
- 不做自动 retry。
- 不做后台队列。
```

---

## 6. 歌曲解析与 timing

V2 增加歌曲解析功能。输入为：

```text
active_music_take.mp3
lyrics.md
```

Python/librosa 负责生成：

```text
- audio_duration_sec
- tempo / bpm candidates
- beat_grid.json
- onset_events.json
- energy_curve.json
- silence / low-energy hints
```

WhisperX 负责 word-level timing 主路径。V2 必须生成：

```text
lyric_word_timing.json
alignment_report.json
```

WhisperX 主路径：

```text
- 使用 WhisperX 产出 word-level timestamps。
- WhisperX 输出必须与 lyrics.md 做文本归一化和 fuzzy mapping。
- word-level timing 不由 librosa 单独完成。
- librosa 继续负责 duration / beat / onset / energy 等音乐证据。
- Montreal Forced Aligner 或其他 forced alignment backend 可作为后续可插拔增强，不作为 V2 主路径。
```

WhisperX 主路径必须记录：

```text
- whisperx version
- model name
- align model
- language
- device
- compute_type
- CUDA / driver environment
- input audio sha256
- normalized lyrics sha256
- word alignment confidence / score（如 backend 提供）
- unmatched_words
- low_confidence_words
```

运行环境：

```text
- WhisperX full local E2E 默认使用 CUDA/GPU。
- CPU 只允许 smoke 或诊断，不作为三比例完整真实 E2E 通过门槛。
- 如果本地没有可用 GPU，V2 媒体 E2E 不能判定完成。
```

质量门槛：

```text
- word coverage >= 85%
- low_confidence_words <= 15%
- unmatched_words <= 10%
- section duration coverage >= 98%
- section 边界必须贴近 beat/onset/energy 证据，容忍 0.5s
- 任一比例不达标，则该比例本地真实 E2E fail
```

`lyrics.md` 是唯一歌词文本源。`lyric_word_timing.json` 的词面文本必须来自 `lyrics.md` 归一化后的词序列。WhisperX/ASR transcript 只作为对齐证据，不是歌词真相，不得自动改写 `lyrics.md`。

自动对齐不达标时，允许提供 `alignment_override.json`。该文件只能修正词、行、段落的 timing 映射，不能修改歌词词序或词面文本。override 规则：

```text
- workflow 必须先跑 WhisperX + lyrics fuzzy mapping。
- 只有质量门槛不达标时，才允许使用 alignment_override.json。
- override 只能覆盖失败片段或低置信片段。
- override 不能整份替代 WhisperX 输出。
- override 不能修改 lyrics.md 的词面文本或词序。
- manifest 必须记录 before_metrics、after_metrics、changed_ranges、reason、author。
- 应用 override 后仍不达标，则该比例 E2E fail。
```

`section_map.json` 由以下证据综合生成：

```text
- lyrics.md 段落结构
- word-level timing
- beat_grid
- onset_events
- energy_curve
- silence / low-energy hints
```

每个 section 至少包含：

```text
- section_id
- start_sec
- end_sec
- duration_sec
- lyric_paragraph_ids
- word_range
- beat_range
- energy_summary
- alignment_confidence
- evidence
```

质量要求：

```text
- section_map 总时长覆盖 active_music_take.mp3 duration。
- section 之间不得重叠。
- section 边界应贴近 beat/onset/energy 证据。
- lyrics.md 与 WhisperX/ASR 证据不一致时，必须记录 unmatched_words / low_confidence_words。
- alignment_report.json 必须进入 render_manifest。
```

---

## 7. 背景图生成

V2 背景图生成为真实 E2E 步骤。每套比例 fixture 都必须至少一个 scene 启用背景图生成。

触发条件：

```text
- image_generation_plan.json 存在；且
- 至少一个 scene 声明 image_generation.enabled = true。
```

流程：

```text
1. 读取 scene 级 image generation 请求。
2. 调用真实 image generation adapter。
3. 生成候选图到 assets/images/generated/。
4. 记录 request / response / provenance。
5. 通过文件/API 执行 lock/reject/skip。
6. 只有 locked image asset 写入 image_assets.json。
7. 只有 locked 本地图片可以进入 ContentGraph、agent_context 和 frame HTML。
```

V2 使用抽象 adapter 接口，主实现为 Codex image_gen：

```text
generateImageCandidates(request) -> ImageGenerationResult
```

PRD 不绑定不稳定的具体 CLI 子命令。实现必须提供一个真实 Codex image_gen adapter，并在 manifest 中记录 adapter id、request、response、provenance、输出文件 hash。

禁止：

```text
- 未 locked 候选图进入视频制作。
- frame agent 临时生图。
- frame HTML 引用外链图。
- frame HTML 引用 image_assets.json 以外的图片。
```

---

## 8. 三比例真实 E2E

V2 必须维护三套独立 fixture bundle：

```text
fixtures/media-e2e-v2/
  portrait-9x16/
  landscape-16x9/
  square-1x1/
```

每套 fixture 时长：

```text
- 20-40s 真实媒体样本。
- 至少包含 hook / body / outro 3 个 section。
- 不要求三套 fixture 达到 90-120s。
- 90-120s 长成片 E2E 进入后续版本或单独长样本验收。
```

每套都必须完整跑通真实 E2E：

```text
- fixture bundle validation
- audio/timing analysis
- WhisperX word-level timing
- section_map construction
- background image generation（每套至少一个 scene 启用）
- image lock/reject/skip gate
- html-video workspace write
- html-video agent/runtime real run
- frame output validation
- static preview smoke
- visual render
- active_music_take.mp3 mux to AAC
- visual + final ffprobe
- render_manifest evidence
```

比例要求：

```text
portrait-9x16: 9:16
landscape-16x9: 16:9
square-1x1: 1:1
```

V2 不接受“schema 支持三比例但只真实跑一个比例”的验收结论。每套 fixture 都必须至少有一个 locked image asset 被对应比例的 frame HTML 引用。

---

## 9. strict duration 责任边界

strict duration 责任归 html-video。

Qivance V2 不重复实现 CSS/GSAP/Web Animations 动画时长检测。

Qivance V2 只负责：

```text
- 确保传给 html-video render 的 frame duration 来自 ContentGraph / qivance-frame-contracts。
- 确保 html-video render 使用 explicit duration / strict duration contract。
- 记录 requested frame durations。
- 记录 visual actual duration。
- 记录 final actual duration。
- 记录 duration drift。
- 当 html-video explicit duration 行为回退或输出发生 auto-extend 漂移时，E2E/QA 失败。
```

manifest 必须能证明：

```text
- requested duration
- rendered visual duration
- final duration
- duration_drift_ms <= 150
- render config 使用 html-video explicit duration 语义
```

---

## 10. 音频 mux

V2 输入音频固定为：

```text
audio/master/active_music_take.mp3
```

Qivance V2 不生成歌曲、不选择 take，只 mux 已锁定 mp3。

最终输出：

```text
exports/final.mp4
```

音频编码：

```text
final audio codec = AAC
```

推荐 mux 语义：

```text
ffmpeg -y \
  -i exports/visual_silent.mp4 \
  -i audio/master/active_music_take.mp3 \
  -map 0:v:0 \
  -map 1:a:0 \
  -c:v copy \
  -c:a aac \
  -b:a 192k \
  -movflags +faststart \
  exports/final.mp4
```

QA：

```text
- sourceAudio.codec = mp3
- sourceAudio.sha256 已记录
- finalProbe.audio.codec = aac
- finalProbe.audio.streamCount = 1
- final duration 与 active_music_take.mp3 duration drift <= 150ms
```

---

## 11. Frame agent 与 Preview

html-video 负责：

```text
- agent/runtime 执行
- frame HTML 生成
- 与 html-video 项目结构和模板机制对齐
- render 能消费生成的 frames
```

Qivance 负责：

```text
- 生成 agent_context.json
- 生成 qivance-frame-contracts.json
- 注入 lyrics/timing/beat/word/style/image_assets 等权威上下文
- 限制可写路径或校验变更范围
- 校验 frames/*.html 数量、metadata、duration contract、本地 locked image 引用
- 记录 agent run evidence 到 render_manifest
```

V2 只做静态 Preview smoke。

包含：

```text
- Preview model/API 可读取 project.json、content-graph.json、qivance-frame-contracts.json、frames。
- frame static serving path traversal 继续受保护。
- 可选浏览器 smoke：frame 页面可打开、非空白。
```

不包含：

```text
- 用户修改意见。
- revise endpoint。
- 多轮 agent turns。
- Preview 编辑 UI。
- agent run history UI。
```

---

## 12. render_manifest.json

`render_manifest.json` 是 V2 机器可读主证据。

每套比例都必须写：

```text
exports/render_manifest.json
```

manifest 至少记录：

```text
- schema_version
- project_id
- aspect_ratio / resolution / fps
- workflow run id
- step checkpoints
- force options
- input artifact paths + sha256
- active_music_take.mp3 path + sha256 + ffprobe
- lyrics.md path + sha256
- audio analysis outputs + sha256
- whisperx metadata
- word-level timing metrics
- alignment_report path + sha256
- alignment_override path + sha256（如使用）
- image_generation_plan path + sha256
- image generation adapter id
- image generation request / response / provenance
- image candidate status: generated / locked / rejected / skipped
- image_assets.json path + sha256
- html-video project path
- html-video agent/runtime metadata
- frame list + sha256
- frame contract duration vs ContentGraph duration
- local locked image reference validation
- html-video render config, including explicit duration semantics
- visual_silent.mp4 path + sha256 + ffprobe
- mux command metadata
- final.mp4 path + sha256 + ffprobe
- final audio codec = AAC
- stream count checks
- duration drift checks
- pass/fail status
- diagnostics
```

`TEST_REPORT.v2.md` 只做人类可读总结：

```text
- 三比例 manifest 路径
- 每比例 pass/fail
- 执行命令
- 环境依赖版本
- 未证明项
- 风险
- 下一版决策
```

---

## 13. 本地 E2E 与 CI

V2 完成判定：

```text
- 本地三比例完整真实 E2E 全部通过。
- 每套比例都有 render_manifest.json。
- docs/TEST_REPORT.v2.md 汇总三套 manifest。
- 缺 Codex/html-video agent runtime/image_gen/render/ffmpeg/ffprobe/WhisperX/GPU 任一真实路径时，V2 媒体 E2E 不算完成。
```

CI 范围：

```text
- typecheck
- unit tests
- workflow schema tests
- mock image_gen adapter tests
- mock html-video agent/runtime tests
- audio analysis parser tests with small fixtures
- manifest tests
- ffprobe parser tests
- optional render smoke if environment available
```

CI 不要求真实三比例媒体 E2E。

---

## 14. 后续 SPEC/PLAN 需细化

当前 PRD 的核心产品边界已确认。后续 SPEC/PLAN 阶段仍需细化实现级参数：

```text
- WhisperX 模型大小、device、compute_type 默认值。
- Codex image_gen adapter 的实际调用入口。
- alignment_override.json 的精确 JSON schema。
- render_manifest.json 的精确 JSON schema。
- 三套 fixture 的具体内容主题。
```

---

## 15. 文档交付要求

V2 完成后，按项目文档治理顺序更新：

1. 写入 `docs/TEST_REPORT.v2.md`。
2. 更新 `docs/requirements traceability matrix.md` 的 V2 状态、测试证据和下一版决策。
3. 回到父 PRD 校准目标态，不覆盖本子 PRD。
4. 更新唯一目标 SPEC：`SPEC.target.md`。
5. 从目标 SPEC 写独立 V2 Delta SPEC。
6. 从 Delta SPEC 写或更新 PLAN。

若本子 PRD 与父 PRD 冲突，以父 PRD 为准，先修正本子 PRD。若 SPEC 与代码现实冲突，先记录 gap，再决定迁移代码、重构代码或调整 SPEC。
