# MiniMax Music 之后 Preview 工作流 MVP 计划

> **范围锁定**：第一版 MVP 只做 MiniMax Music 之后的 Preview 工作流。  
> **输入边界**：用户后续补齐已生成并接受的 MiniMax 音频、歌词和项目配置。  
> **输出边界**：系统生成可预览、可 QA、可下载的 `preview_composite.mp4` 和配套报告。  
> **参考文件**：`01_minimal_web_ui_spec.md`、`02_workflow_state_machine_spec.md`、`03_asset_directory_spec.md`、`04_local_render_qa_boundary_spec.md`。

---

## 1. 目标

本地 MVP 要验证一件事：

> 给定一版已经接受的 MiniMax Music 音频，系统能把它锁定为时间线真值，并自动生成节拍、段落映射、分镜、HypeFrames 工程、Preview 视频和 QA 报告。

第一版不验证主题到歌词、不验证 MiniMax 生成、不验证 SaaS 计费。它只验证音频之后的自动化视频生产闭环是否成立。

成功标准：

1. 用户导入一个本地输入包后，项目进入 `music_accepted`。
2. 用户点击“生成 Preview”后，工作流从 `music_accepted` 跑到 `export_ready`。
3. 项目目录符合 `03_asset_directory_spec.md`。
4. `dist/preview_composite.mp4` 是第一视频产物。
5. `qa/master_qa_report.json` 能说明 Preview 是否可用、是否需要人工 review。

---

## 2. 第一版明确不做

以下内容在 docs 中属于完整 MVP 或 P1，但本计划第一版不做：

1. DeepSeek 资料消化。
2. DeepSeek 歌词生成。
3. MiniMax Music API 调用。
4. 音乐试听、重新生成、版本选择 UI。
5. 真实积分冻结、结算、退款。
6. 登录注册和 Workspace 权限。
7. Agent API 鉴权、预算、webhook。
8. 管理后台。
9. 剪映分层包、透明叠层、`capcut_handoff_pack/`。
10. 模板市场、批量生产、自动发布。

对应调整：

| docs 原能力 | 第一版处理方式 |
|---|---|
| 创建项目 | 改为导入已接受音乐项目。 |
| 歌词生成 | 不生成，只展示导入的 `lyrics.md` 和解析结果。 |
| MiniMax 音乐生成 | 不调用，只接收本地 `minimax_rap_raw.mp3` 或 `.wav`。 |
| 音乐接受 | 导入时即视为已接受，状态为 `music_accepted`。 |
| 积分显性 | 只保留成本字段和 UI 占位，不做真实账本。 |
| Agent 可观测 | 后置，不作为第一版验收。 |

---

## 3. 技术方案

默认技术栈：

1. Next.js + React + TypeScript：本地 Web UI 和 API route。
2. Prisma + SQLite：保存项目、步骤、资产索引和工作流状态。
3. 本地文件系统：保存每个项目的标准资产目录。
4. Node worker：执行音频锁定、节拍、分镜、HypeFrames 工程生成和渲染任务。
5. FFmpeg / ffprobe：音频转码、时长检测、视频 QA。
6. HyperFrames CLI：`lint`、`inspect`、`render` Preview 和 Review。

目录建议：

```text
app/
  projects/
  api/
components/
lib/
  workflow/
  assets/
  audio/
  planning/
  hypeframes/
  render/
worker/
prisma/
projects/
```

`projects/` 是本地生成产物目录，不应提交生成内容；代码实现时应加入 `.gitignore`。

---

## 4. 输入包

导入页只要求最小输入：

```text
input/input_config.json
data/lyrics.md
audio/minimax_rap_raw.mp3
```

可选输入：

```text
data/lyrics_structured.json
data/selected_music_prompt.json
data/facts.json
input/project_brief.md
```

导入规则：

1. 如果缺少 `project_brief.md`，由 `input_config.json` 生成一份简短说明。
2. 如果缺少 `lyrics_structured.json`，从 `lyrics.md` 的段落标签和空行做保守解析。
3. 如果缺少 `selected_music_prompt.json`，写入一个 `source: "external_minimax"` 的占位文件。
4. 如果音频不是 `.mp3`，仍导入为原始音频，但稳定文件名统一为 `audio/minimax_rap_raw.<ext>`，后续 master 统一生成 `minimax_rap_master.wav`。
5. 导入成功后写入 `project_manifest.json`、`asset_manifest.json`、`workflow_snapshot.json`，Project 状态置为 `music_accepted`。

---

## 5. 工作流

第一版只实现以下状态路径：

```text
music_accepted
→ beat_locking
→ beat_locked
→ section_mapping
→ timing_qa_running
→ timing_ready
→ scene_planning
→ scene_qa_running
→ scene_ready
→ hypeframes_generating
→ hypeframes_file_qa_running
→ hypeframes_ready
→ preview_rendering
→ preview_ready
→ render_qa_running
→ render_passed
→ export_ready
```

异常状态：

| 状态 | 触发条件 | 第一版处理 |
|---|---|---|
| `beat_needs_review` | BPM / downbeat 置信度低 | UI 允许手动填 BPM、首拍时间、重新生成 `beats.locked.json`。 |
| `timing_needs_review` | section 太密、越界或 Hook 对不齐 | UI 展示问题，允许重新跑 section mapping。 |
| `scene_needs_review` | 分镜过密或不可读 | 降级为卡片式模板重新生成。 |
| `hypeframes_blocked` | 文件缺失、路径错误、lint 失败 | 返回工程生成步骤，不让 Worker 直接改状态。 |
| `render_blocked` | 黑屏、缺音频、时长严重不一致 | 允许重新渲染或回到 HypeFrames 生成。 |

每个自动步骤都必须创建 `StepRun`，并写入 `logs/step_runs.jsonl`。

---

## 6. 产物

第一版必须生成：

```text
project_{project_id}/
  project_manifest.json
  asset_manifest.json
  workflow_snapshot.json
  input/
    input_config.json
    project_brief.md
  data/
    lyrics.md
    lyrics_structured.json
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
  audio/
    minimax_rap_raw.mp3
    minimax_rap_master.wav
    minimax_rap_analysis.wav
    music_manifest.json
    versions/
  hypeframes/
    index.html
    styles.css
    render_targets.json
    package_manifest.json
    compositions/
    generated/
  qa/
    music_ingest_qa_report.json
    beat_lock_qa_report.json
    timing_qa_report.json
    scene_qa_report.json
    hypeframes_file_qa_report.json
    render_qa_report.json
    master_qa_report.json
  dist/
    preview_composite.mp4
    preview_composite_review.mp4
    keyframes_contact_sheet.jpg
    render_manifest.json
  logs/
    step_runs.jsonl
    render_worker.log
    errors.jsonl
```

第一版不生成：

```text
dist/overlay_full_alpha.mov
dist/captions_alpha.mov
dist/bg_clean.mp4
capcut_handoff_pack/
```

---

## 7. Web UI

第一版最小页面：

| 页面 | 路由 | 第一版内容 |
|---|---|---|
| 项目列表 | `/projects` | 项目标题、状态、更新时间、是否有 Preview、导入按钮。 |
| 导入项目 | `/projects/new` | 上传输入包或分别上传 config、lyrics、audio。 |
| 项目工作台 | `/projects/{id}` | 状态条、步骤日志、当前可执行操作。 |
| Music | 工作台 Tab | 展示导入音频、歌词、音频 manifest，不提供 MiniMax 生成按钮。 |
| Video | 工作台 Tab | 生成 Preview、播放 Preview / Review、展示关键帧。 |
| QA | 工作台 Tab | 展示所有 QA report 的状态、warning、blocking issue。 |
| Export | 工作台 Tab | 下载 Preview、Review、音频、manifest、QA 报告。 |
| Logs | 工作台 Tab | StepRun、错误、Worker 日志摘要。 |

按钮规则：

1. `music_accepted` 时显示“生成 Preview 工作流”。
2. `beat_needs_review` 时显示 BPM / downbeat 修正表单。
3. `hypeframes_ready` 时显示“渲染 Preview”。
4. `preview_ready` 时自动进入 Render QA，或显示“运行 Render QA”。
5. `render_passed` 时显示“标记可导出”。
6. `export_ready` 时显示下载入口。

---

## 8. 实施里程碑

### M1：项目导入与资产目录

目标：导入已接受音频项目，生成标准目录和数据库索引。

验收：

1. `/projects/new` 能导入最小输入包。
2. 文件落盘到 `project_{project_id}/`。
3. 缺少可选文件时能生成默认文件。
4. Project 状态为 `music_accepted`。
5. UI 能打开项目工作台并展示导入音频和歌词。

### M2：音频锁定与节拍真值

目标：把导入音频变成后续视频时间线唯一真值。

验收：

1. 生成 `audio/minimax_rap_master.wav`。
2. 生成 `audio/minimax_rap_analysis.wav`。
3. 生成 `audio/music_manifest.json`，包含时长、hash、路径、版本。
4. 生成 `data/beats.auto.json` 和 `data/beats.locked.json`。
5. `beats.locked.json` 记录 `locked_audio_hash`。
6. 低置信度进入 `beat_needs_review`，可人工修正后继续。

### M3：段落映射与 Timing QA

目标：把歌词结构映射到真实音频时间线。

验收：

1. 生成 `data/section_map.json`。
2. 生成 `data/section_density_report.json`。
3. 生成 `qa/timing_qa_report.json`。
4. section 时间不越界，开始点尽量贴近小节线。
5. Timing QA 阻断时不能进入分镜。

### M4：分镜、字幕和视觉计划

目标：不依赖 LLM，先用默认卡片式科普模板生成可渲染计划。

验收：

1. 生成 `data/scene_plan.json`。
2. 生成 `data/caption_plan.json`。
3. 生成 `data/visual_plan.json`。
4. 生成 `qa/scene_qa_report.json`。
5. 字幕和关键词不过密，scene 数量与 section 对齐。

### M5：HypeFrames 工程生成与文件 QA

目标：从计划文件生成可复现的 HypeFrames 工程。

验收：

1. 生成 `hypeframes/index.html`。
2. 生成 `hypeframes/styles.css`。
3. 生成 `hypeframes/render_targets.json`。
4. 生成 `hypeframes/package_manifest.json`。
5. 运行 HypeFrames lint / inspect。
6. 生成 `qa/hypeframes_file_qa_report.json`。
7. QA 标记只进入 Review，不进入 Preview。

### M6：本地渲染与 Render QA

目标：生成第一交付物 `preview_composite.mp4`。

验收：

1. 先渲染 `dist/preview_composite.mp4`。
2. 再渲染 `dist/preview_composite_review.mp4`。
3. 生成 `dist/keyframes_contact_sheet.jpg`。
4. 生成 `dist/render_manifest.json`。
5. 生成 `qa/render_qa_report.json`。
6. 视频时长与主音频时长在容差内。
7. Preview 包含正确音频轨。
8. Worker 不直接更新 Project 状态，只返回结果给 Orchestrator。

### M7：导出与验收闭环

目标：用户能在 UI 里预览并下载全部第一版产物。

验收：

1. Render QA 通过后进入 `render_passed`。
2. 用户确认后进入 `export_ready`。
3. Export Tab 可下载 Preview、Review、主音频、歌词、manifest、QA 报告。
4. `qa/master_qa_report.json` 汇总全链路状态。

---

## 9. 测试计划

单元测试：

1. `lyrics.md` 解析为 `lyrics_structured.json`。
2. 音频 manifest hash / duration 生成。
3. beat lock 输出包含 `locked_audio_hash`。
4. section mapping 不越界。
5. QA report 统一字段完整。
6. 状态机不允许跳过阻断状态。

集成测试：

1. 使用 10-20 秒 fixture 音频跑 M1-M4。
2. 缺少可选文件时导入仍成功。
3. 缺少必需音频时导入失败并显示错误。
4. `beat_needs_review` 人工修正后能继续。
5. HypeFrames File QA 失败时不进入渲染。

端到端测试：

1. 从 `/projects/new` 导入样例项目。
2. 点击“生成 Preview 工作流”。
3. 等待状态到 `export_ready`。
4. 播放 `preview_composite.mp4`。
5. 下载 Preview、Review、主音频、QA 报告。

本地渲染验证：

1. `npx hyperframes lint` 通过。
2. `npx hyperframes inspect` 无阻断。
3. `npx hyperframes render` 生成 Preview。
4. `ffprobe` 检查音频轨、时长、分辨率、fps。
5. 关键帧 contact sheet 非空、非全黑。

---

## 10. 交付顺序

建议按以下顺序实现，保证每一步都能单独验收：

1. Scaffold 本地 Web app、Prisma、基础项目表。
2. 实现标准项目目录创建和导入。
3. 实现状态机和 StepRun 日志。
4. 实现音频锁定和 manifest。
5. 实现 beat lock 和人工 override。
6. 实现 section mapping 和 Timing QA。
7. 实现默认分镜、字幕、视觉计划。
8. 实现 HypeFrames 工程生成。
9. 实现本地 Render Worker。
10. 实现 Preview / QA / Export UI。
11. 补齐自动化测试和样例项目。

---

## 11. 第一版最终验收清单

- [ ] 导入最小输入包后进入 `music_accepted`。
- [ ] 项目目录结构符合 `03_asset_directory_spec.md` 的 Preview-only 必需资产。
- [ ] 每个步骤都有 StepRun 和日志。
- [ ] `music_manifest.json` 记录音频实际时长和 hash。
- [ ] `beats.locked.json` 记录锁定音频 hash。
- [ ] `section_map.json` 不使用目标时长作为最终真值。
- [ ] `scene_plan.json`、`caption_plan.json`、`visual_plan.json` 可直接驱动 HypeFrames。
- [ ] `hypeframes_file_qa_report.json` 通过后才允许渲染。
- [ ] `preview_composite.mp4` 优先生成。
- [ ] `preview_composite_review.mp4` 的 QA 标记不进入 Preview。
- [ ] `render_manifest.json` 包含 hash、fps、分辨率、音视频时长。
- [ ] `render_qa_report.json` 能阻断黑屏、缺音频、严重错时长。
- [ ] `master_qa_report.json` 给出最终可导出结论。
- [ ] Web UI 可播放 Preview 并下载第一版资产。
- [ ] 第一版不出现 MiniMax 生成、歌词生成、积分扣费、管理后台、剪映分层包入口。
