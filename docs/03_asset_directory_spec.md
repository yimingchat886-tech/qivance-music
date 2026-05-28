# 资产目录定义

> 文档版本：v0.1  
> 文档类型：Asset Directory Specification  
> 适用范围：本地渲染目录、对象存储路径、项目归档、剪映交接包  
> 核心原则：Preview-First、音频锁定、节拍唯一真值、资产可复现、版本可追踪

---

## 1. 文档目标

本文件定义每个项目的标准资产目录、文件命名、必需产物、可选产物、版本策略和剪映交接包结构。

目标是让后端、HypeFrames、本地渲染 Worker、QA、Agent 和 Web UI 使用同一套资产约定，避免出现以下问题：

1. 找不到最新音频；
2. Preview 使用了错误音频版本；
3. QA 报告对应不上渲染产物；
4. 分层资产和剪映交接包缺文件；
5. 失败重试覆盖历史产物；
6. Agent 无法判断哪些文件可下载。

---

## 2. 总体目录结构

每个项目在本地渲染环境中应映射为一个独立目录：

```text
project_{project_id}/
  project_manifest.json
  input/
  data/
  audio/
  hypeframes/
  qa/
  dist/
  capcut_handoff_pack/
  logs/
  versions/
  archive/
```

### 2.1 目录职责

| 目录 | 职责 |
|---|---|
| 根目录 | 放置项目总 manifest 和只读索引。 |
| `input/` | 用户输入、参考资料、项目简报。 |
| `data/` | 事实卡、歌词、节拍、分段、分镜、字幕、视觉计划等结构化数据。 |
| `audio/` | MiniMax 原始音频、主音频、分析音频、音频 manifest。 |
| `hypeframes/` | HypeFrames 工程文件。 |
| `qa/` | 各阶段 QA 报告。 |
| `dist/` | 渲染输出视频和图片产物。 |
| `capcut_handoff_pack/` | 剪映交接包。 |
| `logs/` | StepRun 摘要、渲染日志、错误记录。 |
| `versions/` | 重要产物的版本归档。 |
| `archive/` | 项目最终归档包或冷存储索引。 |

---

## 3. 根目录文件

| 文件 | 必需 | 说明 |
|---|---:|---|
| `project_manifest.json` | 是 | 项目级总索引。 |
| `asset_manifest.json` | 是 | 当前有效资产清单。 |
| `workflow_snapshot.json` | 是 | 当前状态机快照。 |
| `credit_snapshot.json` | 否 | 积分使用摘要，供导出审计。 |
| `README.md` | 否 | 人类可读项目说明。 |

### 3.1 `project_manifest.json` 应包含

| 字段 | 说明 |
|---|---|
| `project_id` | 项目 ID。 |
| `workspace_id` | 工作区 ID。 |
| `created_by_type` | human / agent / system。 |
| `topic` | 科普主题。 |
| `target_duration` | 目标时长档位。 |
| `actual_audio_duration` | 锁定音频实际时长。 |
| `aspect_ratio` | 画幅。 |
| `current_workflow_state` | 当前状态。 |
| `locked_audio_hash` | 主音频 hash。 |
| `preview_video_hash` | Preview 视频 hash。 |
| `created_at` | 创建时间。 |
| `updated_at` | 最近更新时间。 |

---

## 4. `input/` 目录

```text
input/
  input_config.json
  project_brief.md
  source_materials/
    source_001.md
    source_002.pdf
    source_003.txt
  source_index.json
```

### 4.1 文件说明

| 文件 | 必需 | 说明 |
|---|---:|---|
| `input_config.json` | 是 | 全链路配置源。 |
| `project_brief.md` | 是 | 人类可读项目简报。 |
| `source_materials/` | 否 | 原始参考资料。 |
| `source_index.json` | 有资料时必需 | 资料索引、hash、来源、上传时间。 |

### 4.2 `input_config.json` 核心字段

| 字段 | 说明 |
|---|---|
| `topic` | 科普主题。 |
| `target_duration` | 目标时长档位。 |
| `audience` | 目标受众。 |
| `tone` | 语气。 |
| `rap_style` | Rap 风格。 |
| `aspect_ratio` | 画幅。 |
| `platform` | 发布平台。 |
| `budget_limit` | 项目预算上限。 |
| `auto_continue` | 是否允许自动推进。 |
| `auto_approve_music` | 是否允许自动接受音乐。 |
| `auto_approve_preview` | 是否允许自动接受 Preview。 |

---

## 5. `data/` 目录

```text
data/
  facts.json
  source_notes.md
  lyrics.md
  lyrics_structured.json
  minimax_prompt_options.json
  selected_music_prompt.json
  beats.auto.json
  beats.locked.json
  beat_diagnostics.md
  section_map.json
  section_density_report.json
  scene_plan.json
  caption_plan.json
  visual_plan.json
  render_plan.json
```

### 5.1 资料与歌词产物

| 文件 | 必需 | 说明 |
|---|---:|---|
| `facts.json` | 有资料时必需 | 事实卡、术语、类比、禁说项。 |
| `source_notes.md` | 有资料时建议 | 资料摘要与引用备注。 |
| `lyrics.md` | 是 | 送入 MiniMax 的歌词正文。 |
| `lyrics_structured.json` | 是 | 结构化歌词段落。 |
| `minimax_prompt_options.json` | 是 | DeepSeek 生成的候选音乐 prompt。 |
| `selected_music_prompt.json` | 是 | 最终选择的 MiniMax prompt。 |

### 5.2 时间线产物

| 文件 | 必需 | 说明 |
|---|---:|---|
| `beats.auto.json` | 是 | 自动节拍检测结果。 |
| `beats.locked.json` | 是 | 视频时间线唯一节拍真值。 |
| `beat_diagnostics.md` | 是 | BPM、拍点稳定性、置信度说明。 |
| `section_map.json` | 是 | 歌词结构到音频时间码映射。 |
| `section_density_report.json` | 是 | 信息密度、字幕密度、视觉承载风险。 |

### 5.3 视频规划产物

| 文件 | 必需 | 说明 |
|---|---:|---|
| `scene_plan.json` | 是 | 分镜计划。 |
| `caption_plan.json` | 是 | 字幕、关键词、停留时间。 |
| `visual_plan.json` | 是 | 图解组件、卡片、箭头、计数器、背景。 |
| `render_plan.json` | 是 | HypeFrames 渲染目标和参数。 |

---

## 6. `audio/` 目录

```text
audio/
  minimax_rap_raw.mp3
  minimax_rap_master.wav
  minimax_rap_analysis.wav
  music_manifest.json
  versions/
    music_v001/
      minimax_rap_raw.mp3
      minimax_rap_master.wav
      music_manifest.json
    music_v002/
      ...
```

### 6.1 文件说明

| 文件 | 必需 | 说明 |
|---|---:|---|
| `minimax_rap_raw.mp3` | 是 | MiniMax 原始输出音频。 |
| `minimax_rap_master.wav` | 是 | HypeFrames 与剪映使用的主音频。 |
| `minimax_rap_analysis.wav` | 是 | 节拍分析用音频。 |
| `music_manifest.json` | 是 | 音频时长、hash、版本、路径、Provider 信息。 |
| `versions/` | 是 | 多次音乐生成的历史版本。 |

### 6.2 音频锁定规则

1. 后续视频时间线只能读取 `minimax_rap_master.wav`。
2. `beats.locked.json` 必须记录所使用的 `locked_audio_hash`。
3. 若用户重新生成音乐，必须创建新的 `music_vXXX`，不得覆盖旧版本。
4. 只有被接受的音乐版本可以提升为当前根目录下的 `minimax_rap_master.wav`。
5. Preview、Review、Overlay、剪映交接包必须使用同一音频 hash。

---

## 7. `hypeframes/` 目录

```text
hypeframes/
  index.html
  styles.css
  render_targets.json
  package_manifest.json
  compositions/
    scene_001.html
    scene_002.html
  components/
    caption_component.html
    concept_card.html
    arrow_diagram.html
  assets/
    fonts/
    images/
    icons/
    textures/
  generated/
    timeline.json
    cues.json
```

### 7.1 文件说明

| 文件/目录 | 必需 | 说明 |
|---|---:|---|
| `index.html` | 是 | HypeFrames 主入口。 |
| `styles.css` | 是 | 视觉样式、安全区、字体、层级。 |
| `render_targets.json` | 是 | preview、review、overlay、captions、bg_clean 等输出模式。 |
| `package_manifest.json` | 是 | HypeFrames 工程依赖和版本。 |
| `compositions/` | 是 | 场景片段。 |
| `components/` | 建议 | 可复用图解、字幕、关键词组件。 |
| `assets/` | 视项目而定 | 字体、图标、纹理、图片。 |
| `generated/` | 是 | 由 data 转换出的时间线和 cue 文件。 |

### 7.2 HypeFrames 工程约束

1. 工程不得依赖运行时随机结果。
2. 工程不得在渲染时拉取未登记的外部资源。
3. 所有 cue 时间必须来自 `beats.locked.json` 或 `section_map.json`。
4. `preview_composite` 必须是第一渲染目标。
5. Review 辅助标记只能进入 `preview_composite_review.mp4`。
6. Overlay 输出不得包含背景层。

---

## 8. `qa/` 目录

```text
qa/
  lyrics_qa_report.json
  lyrics_revision_notes.md
  music_ingest_qa_report.json
  beat_lock_qa_report.json
  timing_qa_report.json
  scene_qa_report.json
  scene_revision_notes.md
  hypeframes_file_qa_report.json
  hypeframes_revision_notes.md
  render_qa_report.json
  master_qa_report.json
```

### 8.1 QA 报告说明

| 文件 | 必需 | 说明 |
|---|---:|---|
| `lyrics_qa_report.json` | 是 | 歌词结构、事实、可唱性、格式。 |
| `lyrics_revision_notes.md` | 条件必需 | 自动返修说明。 |
| `music_ingest_qa_report.json` | 是 | 音频下载、hash、时长、响度。 |
| `beat_lock_qa_report.json` | 是 | BPM、拍点、小节、重拍置信度。 |
| `timing_qa_report.json` | 是 | section_map、Hook、小节、信息密度。 |
| `scene_qa_report.json` | 是 | 科普性、一致性、可读性、安全区。 |
| `hypeframes_file_qa_report.json` | 是 | 工程文件完整性、路径、输出模式。 |
| `render_qa_report.json` | 是 | 渲染后文件、时长、音频、关键帧、透明层。 |
| `master_qa_report.json` | 是 | 全链路总审查结论。 |

### 8.2 QA 报告统一字段

| 字段 | 说明 |
|---|---|
| `gate_name` | Gate 名称。 |
| `status` | `auto_approved` / `approved_with_warnings` / `auto_fixed` / `needs_review` / `blocked`。 |
| `blocking_issues` | 阻断问题列表。 |
| `warnings` | 警告列表。 |
| `auto_fixes_applied` | 自动修复记录。 |
| `input_artifacts` | 审查输入资产。 |
| `output_artifacts` | 审查输出资产。 |
| `reviewer_type` | rule / llm / hybrid / human。 |
| `created_at` | 生成时间。 |

---

## 9. `dist/` 目录

```text
dist/
  preview_composite.mp4
  preview_composite_review.mp4
  overlay_full_alpha.mov
  captions_alpha.mov
  bg_clean.mp4
  final_publish.mp4
  keyframes_contact_sheet.jpg
  keyframes/
    t_0000.jpg
    t_0005.jpg
    t_0010.jpg
  render_manifest.json
```

### 9.1 输出优先级

| 优先级 | 文件 | 说明 |
|---:|---|---|
| 1 | `preview_composite.mp4` | 第一交付物，完整合成视频 + 音频。 |
| 2 | `preview_composite_review.mp4` | 内部 QA 审查版。 |
| 3 | `overlay_full_alpha.mov` | 图解、关键词、箭头、节拍强调透明叠层。 |
| 4 | `captions_alpha.mov` | 透明字幕层。 |
| 5 | `bg_clean.mp4` | 无字幕无图解背景。 |
| 6 | `final_publish.mp4` | 剪映或后处理导出的最终发布版。 |

### 9.2 `render_manifest.json` 应包含

| 字段 | 说明 |
|---|---|
| `render_id` | 渲染任务 ID。 |
| `render_targets` | 实际渲染目标。 |
| `audio_hash` | 所用主音频 hash。 |
| `video_duration` | 视频时长。 |
| `audio_duration` | 音频时长。 |
| `fps` | 帧率。 |
| `resolution` | 分辨率。 |
| `artifact_hashes` | 各输出文件 hash。 |
| `qa_report_id` | 关联 Render QA。 |
| `created_at` | 生成时间。 |

---

## 10. `capcut_handoff_pack/` 目录

```text
capcut_handoff_pack/
  README.md
  preview_composite.mp4
  minimax_rap_master.wav
  overlay_full_alpha.mov
  captions_alpha.mov
  captions.srt
  bg_clean.mp4
  beat_markers.csv
  section_markers.csv
  safe_area_guide.png
  render_manifest.json
  handoff_manifest.json
```

### 10.1 交接包职责

剪映交接包只服务轻量包装，不承载主时间线编辑。

| 文件 | 必需 | 说明 |
|---|---:|---|
| `README.md` | 是 | 操作说明和边界。 |
| `preview_composite.mp4` | 是 | 最轻量包装主视频。 |
| `minimax_rap_master.wav` | 是 | 主音频，供标准方案 B 使用。 |
| `overlay_full_alpha.mov` | P1 | 透明图解叠层。 |
| `captions_alpha.mov` | P1 | 透明字幕层。 |
| `captions.srt` | P1 | 可编辑字幕。 |
| `bg_clean.mp4` | P1 | 干净背景层。 |
| `beat_markers.csv` | P1 | 人工排错用拍点。 |
| `section_markers.csv` | P1 | 段落定位。 |
| `safe_area_guide.png` | P1 | 平台安全区参考。 |
| `handoff_manifest.json` | 是 | 文件清单、hash、导入建议。 |

### 10.2 剪映层级建议

| 剪映轨道 | 内容 |
|---:|---|
| 5 | 剪映模板、贴纸、平台特效。 |
| 4 | `overlay_full_alpha.mov`。 |
| 3 | `captions_alpha.mov` 或 `captions.srt`。 |
| 2 | 可选剪映背景模板。 |
| 1 | `bg_clean.mp4`。 |
| 音轨 1 | `minimax_rap_master.wav`。 |

---

## 11. `logs/` 目录

```text
logs/
  step_runs.jsonl
  provider_events.jsonl
  render_worker.log
  errors.jsonl
  credit_events.jsonl
  agent_events.jsonl
```

| 文件 | 说明 |
|---|---|
| `step_runs.jsonl` | 每个 StepRun 的状态变化摘要。 |
| `provider_events.jsonl` | Provider 调用摘要，不放敏感密钥。 |
| `render_worker.log` | 本地渲染日志。 |
| `errors.jsonl` | 标准化错误记录。 |
| `credit_events.jsonl` | 积分冻结、结算、释放摘要。 |
| `agent_events.jsonl` | Agent 动作审计。 |

---

## 12. `versions/` 目录

```text
versions/
  lyrics_v001/
  lyrics_v002/
  music_v001/
  music_v002/
  scene_v001/
  hypeframes_v001/
  render_v001/
```

### 12.1 版本规则

1. 用户或 Agent 触发重新生成时，必须创建新版本目录。
2. 根目录只保留当前有效版本的稳定文件名。
3. 每个版本目录必须包含当时的输入、输出、QA 报告和 manifest。
4. 不允许覆盖已结算任务的原始产物。
5. 导出时以当前有效版本为准。

### 12.2 版本命名

| 类型 | 命名 |
|---|---|
| 歌词 | `lyrics_v001`、`lyrics_v002` |
| 音乐 | `music_v001`、`music_v002` |
| 分镜 | `scene_v001`、`scene_v002` |
| HypeFrames 工程 | `hypeframes_v001`、`hypeframes_v002` |
| 渲染 | `render_v001`、`render_v002` |

---

## 13. 必需资产矩阵

### 13.1 Preview-Only MVP 必需资产

| 阶段 | 必需文件 |
|---|---|
| 输入 | `input/input_config.json`、`input/project_brief.md` |
| 歌词 | `data/lyrics.md`、`data/lyrics_structured.json`、`data/selected_music_prompt.json` |
| 音频 | `audio/minimax_rap_raw.mp3`、`audio/minimax_rap_master.wav`、`audio/music_manifest.json` |
| 节拍 | `data/beats.auto.json`、`data/beats.locked.json`、`data/section_map.json` |
| 分镜 | `data/scene_plan.json`、`data/caption_plan.json`、`data/visual_plan.json` |
| 工程 | `hypeframes/index.html`、`hypeframes/styles.css`、`hypeframes/render_targets.json` |
| QA | `qa/lyrics_qa_report.json`、`qa/timing_qa_report.json`、`qa/scene_qa_report.json`、`qa/hypeframes_file_qa_report.json`、`qa/render_qa_report.json`、`qa/master_qa_report.json` |
| 输出 | `dist/preview_composite.mp4`、`dist/preview_composite_review.mp4`、`dist/render_manifest.json` |

### 13.2 标准方案 B 额外资产

| 阶段 | 文件 |
|---|---|
| 分层视频 | `dist/overlay_full_alpha.mov`、`dist/captions_alpha.mov`、`dist/bg_clean.mp4` |
| 剪映交接 | `capcut_handoff_pack/` 全目录 |
| 标记 | `beat_markers.csv`、`section_markers.csv`、`safe_area_guide.png` |

---

## 14. 存储映射

| 本地路径 | SaaS 对象存储类型 | 访问权限 |
|---|---|---|
| `input/` | private | 用户、后台、Agent 读；系统写。 |
| `data/` | private | 用户读部分；系统写。 |
| `audio/` | private/downloadable | 用户可下载接受版本。 |
| `hypeframes/` | private | 默认仅系统和高级导出可见。 |
| `qa/` | private | 用户可读摘要，后台可读全文。 |
| `dist/` | downloadable | 用户可下载。 |
| `capcut_handoff_pack/` | downloadable | 用户可下载。 |
| `logs/` | internal | 后台和审计可读。 |
| `archive/` | cold/private | 归档用途。 |

---

## 15. 不允许的资产行为

1. 不允许后续步骤直接读取 MiniMax 临时 URL。
2. 不允许多个音频版本共用同一个 `music_manifest.json`。
3. 不允许 Preview 使用未锁定音频。
4. 不允许 Overlay 输出包含背景层。
5. 不允许 Review 辅助标记进入剪映交接包。
6. 不允许重试任务覆盖已结算版本。
7. 不允许渲染时拉取未登记的外部资源。
8. 不允许导出包缺少 manifest。

---

## 16. MVP 验收标准

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| ASSET-01 | 目录完整 | 每个项目创建后具备标准目录结构。 |
| ASSET-02 | 音频锁定 | 接受音乐后生成主音频和 `music_manifest.json`。 |
| ASSET-03 | 节拍真值 | `beats.locked.json` 记录所用音频 hash。 |
| ASSET-04 | Preview 输出 | `dist/preview_composite.mp4` 为第一视频产物。 |
| ASSET-05 | QA 对齐 | 每个 QA 报告能追溯输入和输出资产。 |
| ASSET-06 | 版本不覆盖 | 重生成歌词/音乐/渲染时保留历史版本。 |
| ASSET-07 | 交接包可用 | 标准方案 B 能生成 `capcut_handoff_pack/`。 |
| ASSET-08 | Manifest 完整 | 导出资产均有 hash、路径、版本和时间。 |
| ASSET-09 | Review 隔离 | 审查辅助标记不进入最终导出包。 |
| ASSET-10 | Agent 可读 | Agent 能通过 manifest 判断可下载文件。 |
