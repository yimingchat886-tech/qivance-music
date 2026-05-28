# 本地渲染 / QA 边界定义

> 文档版本：v0.1  
> 文档类型：Local Render & QA Boundary Specification  
> 适用范围：本地渲染 Worker、HypeFrames 渲染、文件级 QA、LLM QA、人类审核边界  
> 核心原则：本地 Worker 做确定性渲染与文件校验，LLM 做语义一致性审查，人类只处理异常和主观决策

---

## 1. 文档目标

本文件定义“本地渲染/QA”系统负责什么、不负责什么，以及它与后端编排、LLM Reviewer、Web UI、Agent、剪映交接之间的边界。

目标是避免以下职责混淆：

1. 本地渲染 Worker 被要求判断视频是否“好看”；
2. LLM 被要求直接听音频找拍子；
3. 人工被迫处理本可自动发现的文件错误；
4. HypeFrames 工程在未通过文件 QA 时进入渲染；
5. 剪映被误用为主时间线编辑器；
6. 积分结算和渲染执行混在同一个本地进程中。

---

## 2. 边界总览

| 层 | 应负责 | 不应负责 |
|---|---|---|
| Orchestrator | 状态机、任务调度、积分冻结/结算、Provider 编排 | 具体渲染像素、音频帧分析实现 |
| Local Render Worker | HypeFrames 本地渲染、文件检查、时长/音频/透明层 QA、关键帧截图 | 扣积分、决定商业策略、主观质量判断 |
| Rule-based QA | JSON schema、文件存在、路径、hash、时长、fps、alpha、黑屏等硬规则 | 科普表达是否准确、画面是否有教学价值 |
| LLM Reviewer | 事实一致性、分镜科普性、字幕密度、报告总结 | 直接生成节拍真值、替代硬规则检查 |
| Human Reviewer | 处理 `needs_review`、主观接受音乐/Preview、异常放行 | 每次固定全量质检、手动卡点、手动重打字幕 |
| CapCut / 剪映 | 封面、贴纸、平台特效、片头片尾、轻包装 | 主节拍编排、核心图解、主字幕时间线 |

---

## 3. 本地渲染 Worker 的定位

本地渲染 Worker 是一个受 Orchestrator 调度的执行节点。它读取标准项目目录，执行 HypeFrames 渲染和确定性 QA，并将结果写回资产目录。

### 3.1 输入

| 输入 | 说明 |
|---|---|
| `project_id` | 项目 ID。 |
| `render_job_id` | 渲染任务 ID。 |
| 项目目录路径 | 如 `project_{project_id}/`。 |
| `render_targets.json` | HypeFrames 输出模式定义。 |
| `render_plan.json` | 渲染参数、分辨率、fps、目标文件。 |
| `beats.locked.json` | 节拍唯一真值。 |
| `section_map.json` | 段落时间线。 |
| `music_manifest.json` | 主音频信息。 |
| `hypeframes_file_qa_report.json` | 渲染前文件 QA 结果。 |

### 3.2 输出

| 输出 | 说明 |
|---|---|
| `dist/preview_composite.mp4` | 第一交付物。 |
| `dist/preview_composite_review.mp4` | 内部审查版。 |
| `dist/overlay_full_alpha.mov` | 标准方案 B 的透明叠层。 |
| `dist/captions_alpha.mov` | 透明字幕层。 |
| `dist/bg_clean.mp4` | 干净背景。 |
| `dist/keyframes_contact_sheet.jpg` | 关键帧合集。 |
| `dist/render_manifest.json` | 渲染清单。 |
| `qa/render_qa_report.json` | 渲染 QA 报告。 |
| `logs/render_worker.log` | 渲染日志。 |

---

## 4. 本地 Worker 必须做的事情

| 类别 | 任务 | 说明 |
|---|---|---|
| 输入校验 | 检查必需文件 | 渲染前确认音频、数据、HypeFrames 文件存在。 |
| 路径校验 | 检查资产路径 | 阻断未登记或不存在的资源。 |
| 音频校验 | 校验主音频 hash | 确认与 `music_manifest.json` 和 `beats.locked.json` 一致。 |
| 渲染执行 | 渲染 Preview | 优先生成 `preview_composite.mp4`。 |
| 渲染执行 | 渲染 Review | 生成带时间码、小节、beat marker、安全区的审查版。 |
| 渲染执行 | 渲染分层资产 | 在标准方案 B 中生成 overlay、captions、bg_clean。 |
| 文件 QA | 检查输出存在 | 确认目标文件生成且非空。 |
| 时长 QA | 检查音视频时长 | 视频时长应与主音频时长在容差内一致。 |
| 编码 QA | 检查 fps、分辨率、码率 | 必须符合项目配置。 |
| 音频 QA | 检查 Preview 是否包含正确音频 | 确认音频轨存在、时长合理。 |
| 透明 QA | 检查 alpha 通道 | overlay/captions 需要有效透明通道。 |
| 关键帧 QA | 抽取关键帧 | scene start、hook、chorus、结尾等位置截图。 |
| 黑屏 QA | 检测明显黑屏/空帧 | 阻断严重渲染失败。 |
| Manifest | 写入 `render_manifest.json` | 记录 hash、时长、fps、分辨率、目标。 |
| 报告 | 写入 `render_qa_report.json` | 给 Orchestrator 和 UI 使用。 |

---

## 5. 本地 Worker 不应做的事情

| 不应做 | 原因 |
|---|---|
| 直接扣除或退还积分 | 积分只能由账本服务处理。 |
| 自行决定自动推进到下一状态 | 状态机只能由 Orchestrator 更新。 |
| 主观判断音乐好不好听 | 这是用户或 Agent 策略。 |
| 主观判断视频是否足够酷 | 本地 QA 只做客观检查。 |
| 直接改写歌词或事实卡 | 内容修改应由 LLM/用户/Agent 产生新版本。 |
| 直接重写 HypeFrames 工程 | Worker 可报告问题，不应越权修改源工程，除非被明确派发修复任务。 |
| 直接调用未登记外部素材 URL | 所有素材必须在 manifest 中登记。 |
| 将 Review 辅助标记放入最终成片 | Review only 元素必须隔离。 |
| 直接写入剪映工程主时间线 | 剪映只是交接目标，不是本地渲染真值。 |
| 隐式选择另一个音频版本 | 所有渲染必须使用锁定音频。 |

---

## 6. 渲染模式定义

| 模式 | 输出文件 | 包含音频 | 包含背景 | 包含字幕 | 包含 QA 标记 | 用途 |
|---|---|---:|---:|---:|---:|---|
| `preview` | `preview_composite.mp4` | 是 | 是 | 是 | 否 | 第一交付物、用户审片。 |
| `review` | `preview_composite_review.mp4` | 是 | 是 | 是 | 是 | 内部 QA、定位问题。 |
| `overlay` | `overlay_full_alpha.mov` | 否 | 否 | 可选 | 否 | 剪映透明图解叠层。 |
| `captions` | `captions_alpha.mov` | 否 | 否 | 是 | 否 | 剪映透明字幕层。 |
| `background` | `bg_clean.mp4` | 否或可选 | 是 | 否 | 否 | 剪映背景层。 |

### 6.1 MVP 渲染顺序

1. `preview`
2. `review`
3. Render QA
4. 若通过且启用标准方案 B，再渲染 `overlay`、`captions`、`background`

---

## 7. 渲染前 QA 边界

渲染前 QA 主要是 HypeFrames File QA。它发生在 `preview_rendering` 之前。

### 7.1 规则型检查

| 检查项 | 阻断条件 |
|---|---|
| 必需文件存在 | 缺 `index.html`、`styles.css`、`render_targets.json`、主音频等。 |
| 路径可解析 | HypeFrames 引用不存在的文件。 |
| 音频 hash 一致 | `music_manifest.json` 与 `beats.locked.json` 不一致。 |
| 输出目标完整 | 缺少 `preview_composite` 目标。 |
| 时间线范围 | scene 或 cue 超出音频时长。 |
| Review 隔离 | QA 标记可能进入非 Review 输出。 |
| 外部依赖 | 渲染时需要未登记的网络资源。 |
| 字体/素材 | 字体或关键素材缺失。 |

### 7.2 LLM 辅助检查

| 检查项 | LLM 角色 |
|---|---|
| scene_plan 与歌词是否一致 | 判断科普表达是否偏离。 |
| caption_plan 是否过密 | 判断观众是否能读完。 |
| visual_plan 是否有解释功能 | 判断是否只是氛围画面。 |
| 安全区策略是否合理 | 判断关键文字是否可能被平台 UI 遮挡。 |

### 7.3 渲染前状态结果

| 结果 | 状态 |
|---|---|
| 全部通过 | `hypeframes_ready` |
| 有警告但不阻断 | `hypeframes_ready`，QA 状态为 `approved_with_warnings` |
| 需人工确认 | `hypeframes_needs_review` |
| 阻断错误 | `hypeframes_blocked` |

---

## 8. 渲染后 QA 边界

渲染后 QA 发生在文件生成之后，目标是判断文件是否可交付、可审片、可进入剪映交接包。

### 8.1 必做检查

| 检查 | 方法类别 | 通过标准 |
|---|---|---|
| 文件存在 | 规则 | 预期文件存在且大小非零。 |
| 视频可解码 | 规则 | 文件能正常读取元数据和帧。 |
| 时长一致 | 规则 | 视频时长与主音频时长在容差内。 |
| 音频轨存在 | 规则 | Preview / Review 含音频轨。 |
| 音频版本正确 | 规则 | Preview 使用锁定音频 hash 对应资产。 |
| 分辨率正确 | 规则 | 与项目画幅配置一致。 |
| fps 正确 | 规则 | 与 render_plan 一致。 |
| 关键帧非空 | 规则 | 关键时间点不应黑屏或空白。 |
| 字幕基本可见 | 规则 + 可选 LLM | 字幕未完全越界、未明显被遮挡。 |
| Alpha 有效 | 规则 | Overlay/Captions 输出存在透明通道。 |
| Review 隔离 | 规则 | Review 标记不进入 Preview。 |

### 8.2 可选检查

| 检查 | 说明 |
|---|---|
| 响度范围 | 避免过低或爆音。 |
| 画面闪烁 | 检测大面积快速闪烁。 |
| OCR 字幕抽检 | 可选，不作为 MVP 必需。 |
| 关键帧 LLM 审查 | LLM 读取 contact sheet 判断是否有科普图解。 |
| 安全区截图审查 | 用模板框检查字幕和核心图解位置。 |

---

## 9. QA 职责分层

### 9.1 Rule-based QA

适合机器确定性检查。

| 范围 | 示例 |
|---|---|
| 文件 | 存在、大小、hash、路径。 |
| 格式 | JSON schema、字段必填、标签格式。 |
| 时间 | 时长、scene 越界、cue 越界。 |
| 音视频 | fps、分辨率、音轨、透明通道。 |
| 稳定性 | 黑屏、空帧、输出目标缺失。 |

### 9.2 LLM QA

适合语义和内容一致性检查。

| 范围 | 示例 |
|---|---|
| 事实一致性 | 歌词是否偏离 facts。 |
| 科普表达 | 是否误导、是否过度简化。 |
| 分镜有效性 | 画面是否解释机制、关系、误区或数字。 |
| 字幕密度 | 信息是否过载。 |
| QA 总结 | 汇总多份报告，输出是否需要人工。 |

### 9.3 Human QA

只处理异常和主观决策。

| 范围 | 示例 |
|---|---|
| 音乐接受 | 是否满意当前音乐版本。 |
| Preview 接受 | 是否接受当前成片效果。 |
| 事实争议 | 系统无法判断的资料冲突。 |
| 节拍争议 | 半速/双倍冲突严重。 |
| 发布包装 | 剪映模板、封面、贴纸、平台风格。 |

---

## 10. QA 状态定义

| 状态 | 含义 | 自动推进 |
|---|---|---:|
| `auto_approved` | 无阻断，无重大警告。 | 是 |
| `approved_with_warnings` | 有轻微风险但可继续。 | 取决于项目设置 |
| `auto_fixed` | 自动修复后通过。 | 是 |
| `needs_review` | 需人工判断。 | 否 |
| `blocked` | 存在阻断错误。 | 否 |

### 10.1 阻断错误示例

| 错误 | 处理 |
|---|---|
| Preview 缺音频 | 重新渲染或检查音频引用。 |
| Preview 时长与音频差异过大 | 阻断，检查 render_plan 或音频版本。 |
| HypeFrames 引用不存在的文件 | 回到工程生成或修复文件。 |
| Overlay 无 alpha | 重新渲染或降级 Preview-only。 |
| `beats.locked.json` 音频 hash 不一致 | 回到 Beat Lock。 |
| 关键帧大面积黑屏 | 回到 HypeFrames 工程或渲染。 |

### 10.2 警告示例

| 警告 | 默认处理 |
|---|---|
| 字幕略密 | 可继续，记录 warning。 |
| 某些关键词停留偏短 | 可继续或自动降级字幕复杂度。 |
| 画面图解偏少 | 可继续但建议人工看 Preview。 |
| 轻微安全区风险 | 可继续，剪映包装时注意。 |
| 部分 beat cue 未完全对齐 | 可继续，若主要 Hook 对齐。 |

---

## 11. 本地 Worker 与 Orchestrator 边界

| 能力 | Orchestrator | Local Worker |
|---|---:|---:|
| 创建 StepRun | 是 | 否 |
| 冻结积分 | 是 | 否 |
| 读取项目目录 | 提供路径 | 是 |
| 执行渲染 | 调度 | 是 |
| 写入渲染产物 | 否 | 是 |
| 写入 QA 报告 | 可汇总 | 是 |
| 状态流转 | 是 | 只返回结果 |
| 释放/结算积分 | 是 | 否 |
| 通知 Web UI / Agent | 是 | 否 |
| 自动重试策略 | 是 | 返回 retryable 信息 |

### 11.1 Worker 返回结果

Worker 应返回结构化结果，至少包含：

| 字段 | 说明 |
|---|---|
| `render_job_id` | 渲染任务 ID。 |
| `status` | succeeded / succeeded_with_warnings / failed_retryable / failed_blocking。 |
| `output_artifacts` | 生成文件列表。 |
| `qa_report_path` | `render_qa_report.json` 路径。 |
| `blocking_issues` | 阻断问题。 |
| `warnings` | 警告。 |
| `logs_path` | 日志路径。 |
| `retry_recommendation` | 是否建议重试。 |

---

## 12. 本地 Worker 与 LLM Reviewer 边界

| 场景 | Local Worker | LLM Reviewer |
|---|---|---|
| JSON schema 校验 | 负责 | 不负责 |
| 文件路径检查 | 负责 | 不负责 |
| 时长和 fps 检查 | 负责 | 不负责 |
| 字幕是否越界 | 初步规则检查 | 可基于截图辅助判断 |
| 画面是否解释知识点 | 提供关键帧 | 负责判断 |
| 歌词与画面是否一致 | 不负责 | 负责判断 |
| 是否可自动通过 | 提供客观结果 | 汇总语义风险 |
| 最终状态流转 | 不负责 | 不负责，交给 Orchestrator |

---

## 13. 本地 Worker 与剪映边界

| 项目 | 本地 Worker / HypeFrames | 剪映 |
|---|---|---|
| 主时间线 | 负责 | 不负责 |
| Beat lock | 负责 | 不负责 |
| 科普图解 | 负责 | 不建议重做 |
| 主字幕节奏 | 负责 | 不建议重打轴 |
| 透明叠层 | 负责输出 | 负责叠加 |
| 封面 | 可不做 | 负责 |
| 贴纸/热梗特效 | 不做 | 负责 |
| 片头片尾 | 可选 | 负责 |
| 平台包装 | 不做 | 负责 |

---

## 14. 安全与隔离要求

| 要求 | 说明 |
|---|---|
| 项目目录隔离 | Worker 只能读写当前项目目录。 |
| 禁止未授权网络访问 | 渲染不得拉取未登记外部资源。 |
| 密钥不落盘 | Provider 密钥不写入日志或 manifest。 |
| 资源大小限制 | 防止异常素材导致磁盘爆满。 |
| 超时控制 | 渲染和 QA 必须有最大执行时间。 |
| 日志脱敏 | 用户资料和 prompt 可摘要记录，不记录敏感密钥。 |
| 可复现 | 同一输入应尽量得到同一输出。 |
| Review 隔离 | QA 辅助标记不能进入最终发布资产。 |

---

## 15. 降级策略

| 失败点 | 降级方案 |
|---|---|
| Preview 渲染失败 | 重试一次；仍失败则回到 HypeFrames File QA。 |
| Review 渲染失败 | 不阻断用户查看 Preview，但记录 warning。 |
| Overlay alpha 失败 | 降级为 Preview-only，剪映只做轻包装。 |
| Captions alpha 失败 | 提供 `captions.srt` 或在 Preview 中固化字幕。 |
| bg_clean 失败 | 使用 Preview 作为主视频，不提供标准方案 B。 |
| 关键帧生成失败 | 不阻断 Preview 下载，但 Render QA 标记 warning。 |
| LLM Review 不可用 | 使用规则 QA 结果，进入人工 review。 |
| 音频 hash 不一致 | 阻断，必须回到音频锁定或 Beat Lock。 |

---

## 16. 本地渲染 MVP 范围

### 16.1 MVP 必做

1. 读取标准项目目录；
2. 检查渲染前必需文件；
3. 渲染 `preview_composite.mp4`；
4. 渲染 `preview_composite_review.mp4`；
5. 检查输出文件存在；
6. 检查音视频时长；
7. 检查音频轨；
8. 检查分辨率和 fps；
9. 抽取关键帧 contact sheet；
10. 输出 `render_manifest.json`；
11. 输出 `render_qa_report.json`。

### 16.2 MVP 不做

1. 完整透明分层资产；
2. 剪映工程自动创建；
3. 复杂 OCR 字幕审查；
4. 自动修复 HypeFrames 源工程；
5. 自动平台发布；
6. 模板市场渲染；
7. 多机分布式调度；
8. 主观画面评分。

### 16.3 P1 增加

1. `overlay_full_alpha.mov`；
2. `captions_alpha.mov`；
3. `bg_clean.mp4`；
4. `capcut_handoff_pack/`；
5. alpha 通道 QA；
6. safe area guide；
7. LLM 基于关键帧审查科普性；
8. 自动降级 Preview-only。

---

## 17. 本地渲染验收标准

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| RENDER-01 | 输入完整性 | 缺失必需文件时阻断并写入 QA 报告。 |
| RENDER-02 | Preview 优先 | 始终优先输出 `preview_composite.mp4`。 |
| RENDER-03 | 音频一致 | Preview 使用锁定主音频。 |
| RENDER-04 | 时长一致 | 视频时长与主音频时长在容差内。 |
| RENDER-05 | Review 隔离 | Review 标记不进入 Preview。 |
| RENDER-06 | 关键帧输出 | 生成 `keyframes_contact_sheet.jpg`。 |
| RENDER-07 | Manifest 完整 | `render_manifest.json` 包含 hash、fps、分辨率、时长。 |
| RENDER-08 | QA 报告完整 | `render_qa_report.json` 给出状态、警告、阻断项。 |
| RENDER-09 | 状态不上写 | Worker 不直接修改 Project 状态。 |
| RENDER-10 | 积分不处理 | Worker 不处理冻结、结算、退款。 |
| RENDER-11 | 可降级 | 分层资产失败时可降级 Preview-only。 |
| RENDER-12 | 可复现 | 同一输入目录重复渲染应产出等价结果。 |

---

## 18. 一句话边界结论

本地渲染/QA 层只负责把已锁定音频、已审查时间线和 HypeFrames 工程确定性地渲染成文件，并用规则检查文件是否可用；它不负责内容创意、主观审美、积分账务、状态流转或剪映主时间线编辑。
