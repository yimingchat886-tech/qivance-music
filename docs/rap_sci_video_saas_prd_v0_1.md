# 科普 Rap 音乐 + 视频 SaaS PRD

> 文档版本：v0.1  
> 文档类型：PRD / 产品需求文档  
> 目标阶段：MVP 规划与产品架构确认  
> 面向对象：产品、设计、OpenDesign、Codex、后端、前端、Agent 自动化工程  
> 生成日期：2026-05-28  
> 参考基线：`MiniMax Music → DeepSeek → HypeFrames → 剪映：Preview-First 自动化视频框架 v0.2`

---

## 1. 产品概述

### 1.1 产品名称

暂定名：**RapScience Studio**

可替代命名：

- RapScience AI
- EduRap Studio
- Science Rap Video SaaS
- BeatExplain

本 PRD 统一使用“本产品”指代。

---

### 1.2 产品定位

本产品是一个面向人类创作者与自动化 Agent 的 **科普 Rap 音乐 + 视频生成 SaaS**。

用户或 Agent 输入科普主题、参考资料、目标时长、语气风格后，系统自动完成：

1. 资料消化；
2. 歌词结构与歌词生成；
3. MiniMax Music 音乐生成；
4. 音频锁定与节拍分析；
5. 科普视频分镜规划；
6. HypeFrames 主时间线工程生成；
7. Preview 合成版渲染；
8. 可选分层资产输出；
9. 剪映轻量包装交接；
10. 最终视频与音乐资产导出。

产品核心不是单一模型调用，而是一个 **可计费、可复用、可审计、可由 Agent 自动执行的多模态内容生产工作流平台**。

---

### 1.3 一句话产品定义

> 输入一个科普主题或资料，自动生成一首科普 Rap 和一支可预览、可包装、可继续编辑的短视频，并通过积分系统管理每一步生成、重试、渲染与导出的成本。

---

### 1.4 设计原则

| 原则 | 说明 |
|---|---|
| Preview-First | 第一交付物优先是完整合成预览视频 `preview_composite.mp4`。 |
| HypeFrames 主时间线 | 主节奏、主分镜、主字幕、主图解不交给剪映完成。 |
| 剪映轻包装 | 剪映只负责封面、贴纸、模板、平台风格特效与最终发布包装。 |
| 音频锁定优先 | MiniMax 生成后必须下载并锁定本地音频，后续时间线以音频实际时长为准。 |
| 节拍真值唯一 | `beats.locked.json` 是后续视频编排的唯一节拍真值。 |
| Agent 可执行 | 产品必须提供稳定的 Agent API，而不是只支持浏览器点击自动化。 |
| 账本式积分 | 所有高成本任务采用预估、冻结、结算、退款的积分账本模型。 |
| 异常审批 | 自动 QA Gate 负责格式、事实、文件和技术一致性审查；人工只处理异常或最终发布包装。 |
| 中间产物资产化 | 歌词、prompt、音频、节拍、分镜、工程文件、QA 报告、视频都作为可追踪资产保存。 |

---

## 2. 背景与问题

### 2.1 用户痛点

当前用 AI 生成科普音乐视频时，通常需要在多个工具之间手动切换：

- 用 LLM 消化资料；
- 手动写歌词；
- 手动整理 MiniMax Music prompt；
- 等待音乐生成；
- 下载音频；
- 自行找节拍；
- 在视频工具中重新分镜、打字幕、做动画；
- 再导入剪映做平台包装。

这个流程存在以下问题：

| 问题 | 表现 |
|---|---|
| 工具割裂 | DeepSeek、MiniMax、HypeFrames、剪映之间没有统一项目状态。 |
| 时间线易错 | 音乐实际时长与目标时长不一致，导致视频错位。 |
| 人工成本高 | 人需要反复检查歌词、事实、节拍、分镜、渲染结果。 |
| 资产不可追踪 | prompt、歌词版本、音频版本、视频版本容易混乱。 |
| Agent 难以执行 | 只靠网页点击，Agent 容易在登录、弹窗、失败重试、支付限制处卡住。 |
| 成本不可控 | 一次任务可能包含多次模型调用、音乐生成和视频渲染，必须有预算和积分控制。 |

---

### 2.2 目标解决的问题

本产品要解决的核心问题：

1. **从主题/资料到科普 Rap 视频的端到端自动化。**
2. **让用户先看到完整 Preview，而不是先处理一堆分层素材。**
3. **把 HypeFrames 作为主视觉与主时间线系统。**
4. **把剪映降级为轻量包装层。**
5. **把人工从固定质检者降级为异常审批者。**
6. **允许 OpenClaw / Hermes / Codex 类 Agent 在拿到账号或 API Key 后自动完成链路。**
7. **用积分制和账本系统控制生成、重试、渲染、导出的成本。**

---

## 3. 产品目标与非目标

### 3.1 产品目标

| 编号 | 目标 | 说明 |
|---|---|---|
| G1 | 跑通端到端创作链路 | 从输入主题到输出 `preview_composite.mp4`。 |
| G2 | 支持人类用户可视化操作 | 用户可通过 Web UI 创建项目、试听音乐、预览视频、导出资产。 |
| G3 | 支持 Agent 自动执行 | Agent 可通过 API 创建项目、上传资料、触发生成、查询状态、导出结果。 |
| G4 | 建立积分制 | 所有高成本任务可预估、冻结、结算和退款。 |
| G5 | 中间资产可追踪 | 每个项目保存歌词、prompt、音频、节拍、分镜、工程和 QA 报告。 |
| G6 | 支持 Preview-First | 第一阶段优先交付完整合成预览版，而不是复杂分层包。 |
| G7 | 支持后续剪映包装 | 输出可用于剪映轻包装的预览版和可选分层资产。 |
| G8 | 降低人工介入 | 仅在事实冲突、节拍低置信度、渲染异常等情况要求人工介入。 |

---

### 3.2 非目标

| 非目标 | 说明 |
|---|---|
| 不做剪映替代品 | 本产品不替代剪映的发布包装能力。 |
| 不做专业 DAW | 不提供精细混音、母带、音轨编辑功能。 |
| 不做主观审美打分系统 | 不判断“好不好听”“够不够炸”；主观质量由用户或 Agent 策略决定。 |
| 不做全版权审查平台 | MVP 只做授权提示、来源记录和基础风险提示。 |
| 不做复杂视频编辑器 | MVP 不提供时间线自由编辑，只提供预览、重试、导出和轻量参数调整。 |
| 不做代码生成界面 | 代码实现交给 OpenDesign / Codex，本 PRD 只定义产品结构和需求。 |

---

## 4. 用户角色

### 4.1 角色列表

| 角色 | 描述 | 核心需求 |
|---|---|---|
| 普通创作者 | 想快速生成科普短视频的人 | 低门槛输入主题，获得成片。 |
| 科普博主 | 有固定内容主题和平台风格 | 批量生成、保留风格、可继续编辑。 |
| 运营人员 | 管理多个账号或栏目 | 稳定出片、导出规范、查看成本。 |
| 教育内容团队 | 制作课程衍生短视频 | 事实准确、结构清晰、输出可归档。 |
| Agent 用户 | OpenClaw / Hermes / 自定义 Agent | 通过账号/API 自动创建、执行和导出任务。 |
| 管理员 | SaaS 运营方 | 管理用户、积分、任务、异常、成本和模板。 |

---

### 4.2 关键用户故事

#### 人类创作者

> 作为一个科普内容创作者，我希望输入一个主题和参考资料后，系统自动生成一首科普 Rap 和一支短视频 Preview，这样我可以快速判断是否值得继续包装发布。

#### 科普博主

> 作为一个固定更新的科普博主，我希望保存自己的视频风格、语气和画面模板，这样每次生成的视频能保持栏目一致性。

#### Agent 用户

> 作为一个自动化 Agent，我希望通过 API 提交目标、资料、预算和权限，然后自动完成歌词、音乐、视频、导出任务，这样我不需要模拟网页点击。

#### 管理员

> 作为 SaaS 管理员，我希望看到每个任务的模型调用、积分消耗、失败原因和资产版本，这样我可以处理账务争议、优化成本和排查生成失败。

---

## 5. 使用场景

### 5.1 标准人类创作场景

1. 用户登录。
2. 创建项目。
3. 输入科普主题、目标时长、语气偏好、画面风格。
4. 可选上传参考资料。
5. 系统生成事实卡和歌词。
6. 用户查看歌词结构与音乐 prompt 候选。
7. 用户选择或编辑 MiniMax music prompt。
8. 系统生成音乐。
9. 用户试听音乐。
10. 用户接受音乐或重新生成。
11. 系统自动完成节拍锁定、分镜规划、HypeFrames 工程生成。
12. 系统渲染 `preview_composite.mp4`。
13. 用户预览视频。
14. 用户导出 Preview 或生成剪映交接包。
15. 用户在剪映中轻量包装并发布。

---

### 5.2 Agent 自动执行场景

1. Agent 使用 API Key 或账号登录。
2. Agent 创建项目并提交：主题、资料、时长、风格、预算、自动审批权限。
3. 系统返回 `agent_run_id` 和预计积分。
4. Agent 确认或直接授权执行。
5. 系统按工作流自动执行。
6. Agent 轮询任务状态或接收 webhook。
7. 如音乐生成成功且 `auto_approve_music=true`，系统自动进入视频生成。
8. 如出现低置信度或预算不足，系统返回 `next_action_required`。
9. 完成后，Agent 下载视频、音频、字幕、manifest 和 QA 报告。

---

### 5.3 异常审批场景

当出现以下情况时，系统进入人工或 Agent 决策节点：

| 异常 | 系统动作 |
|---|---|
| 歌词事实冲突 | 阻断进入 MiniMax，要求用户确认或修改资料。 |
| 音乐生成失败 | 自动释放或退回冻结积分，允许重试。 |
| Beat lock 低置信度 | 提供重分析、重生成音乐、人工选择节拍版本。 |
| 分镜被判定为空泛 MV | 自动降级为卡片式科普模板或要求重做分镜。 |
| 渲染失败 | 自动重试；仍失败则退款或降级 preview-only。 |
| Agent 超预算 | 暂停工作流，返回预算不足状态。 |

---

## 6. 产品范围

### 6.1 MVP 范围

MVP 以 **Preview-Only** 为第一目标。

| 模块 | MVP 是否包含 | 说明 |
|---|---:|---|
| 用户注册/登录 | 是 | 支持个人账号。 |
| 项目创建 | 是 | 支持输入主题、时长、语气、资料。 |
| 资料上传 | 是 | 支持文本、Markdown、PDF 或链接文本化结果。 |
| DeepSeek 资料消化 | 是 | 生成事实卡。 |
| DeepSeek 歌词生成 | 是 | 输出 MiniMax 可用歌词。 |
| 自动歌词 QA | 是 | 只做格式、事实、可唱性初筛。 |
| MiniMax Music 生成 | 是 | 生成 Rap 音频。 |
| 音乐试听与接受 | 是 | 用户可试听、接受、重试。 |
| 音频锁定 | 是 | 下载并生成 master 音频。 |
| Beat lock | 是 | 生成 `beats.auto.json` 和 `beats.locked.json`。 |
| Section mapping | 是 | 生成 `section_map.json`。 |
| 视频分镜计划 | 是 | 生成 `scene_plan.json`、`caption_plan.json`、`visual_plan.json`。 |
| HypeFrames Preview 渲染 | 是 | 输出 `preview_composite.mp4`。 |
| Render QA | 是 | 审查文件存在、时长、音频、关键帧。 |
| 积分系统 | 是 | 余额、冻结、结算、退款。 |
| 基础 Agent API | 是 | 创建项目、触发任务、查询状态、导出。 |
| 管理后台 | 是 | 用户、项目、任务、积分、异常日志。 |
| 剪映分层包 | 否 | MVP 后置。 |
| 模板市场 | 否 | 后置。 |
| 批量生成 | 否 | 后置。 |

---

### 6.2 P1 范围

| 模块 | 说明 |
|---|---|
| 标准方案 B | 输出 `overlay_full_alpha.mov`、`captions_alpha.mov`、`bg_clean.mp4` 和 `capcut_handoff_pack/`。 |
| Webhook | Agent 和外部系统可接收任务完成通知。 |
| Agent 预算策略 | 单项目预算、每日预算、动作权限。 |
| 多模板系统 | 视频模板、字幕模板、图解模板、平台安全区模板。 |
| 版本归档 | 资产版本、prompt 版本、模型版本、渲染版本。 |
| 自动重试策略 | 按错误类型配置重试和退款规则。 |

---

### 6.3 P2 范围

| 模块 | 说明 |
|---|---|
| 批量生产 | 多主题、多资料批量队列。 |
| 团队空间 | 多人协作、权限、团队钱包。 |
| 品牌 preset | 固定颜色、字体、栏目风格、片头片尾。 |
| 模板库/模板市场 | 可复用视频模板、音乐风格模板。 |
| API 商业化 | 面向第三方系统开放完整 API。 |
| 白标输出 | 企业客户可自定义品牌和域名。 |
| 数据分析 | 成本、生成成功率、平均时长、用户留存、积分消耗。 |

---

## 7. 核心流程

### 7.1 全链路流程

```text
用户/Agent 输入
→ 资料消化
→ 歌词生成
→ 歌词 QA Gate
→ MiniMax Music 生成
→ 音乐试听/接受
→ Music Lock / Audio Ingest
→ Beat Lock
→ Section Mapping
→ Timing QA Gate
→ 视频分镜规划
→ Scene QA Gate
→ HypeFrames 工程生成
→ HypeFrames File QA Gate
→ Preview 渲染
→ Render QA Gate
→ 输出 Preview / 分层资产 / 剪映交接包
→ 最终导出
```

---

### 7.2 状态机

| 状态 | 说明 | 主要产物 | 操作者 |
|---|---|---|---|
| `draft` | 项目草稿 | 无 | 用户/Agent |
| `input_ready` | 输入配置完成 | `input_config.json` | 用户/Agent |
| `material_processing` | 资料消化中 | 无 | 系统 |
| `facts_ready` | 事实卡完成 | `facts.json` | DeepSeek |
| `lyrics_generating` | 歌词生成中 | 无 | DeepSeek |
| `lyrics_ready` | 歌词生成完成 | `lyrics.md`、`lyrics_structured.json` | 系统 |
| `lyrics_qa_running` | 歌词审查中 | 无 | QA Gate |
| `lyrics_qa_passed` | 歌词审查通过 | `lyrics_qa_report.json` | 系统 |
| `music_prompt_selected` | 音乐 prompt 已选 | `music_prompt.json` | 用户/Agent |
| `music_generating` | 音乐生成中 | 无 | MiniMax |
| `music_ready` | 音乐生成完成 | `minimax_rap_raw.mp3` | 系统 |
| `music_reviewing` | 等待试听确认 | 音频播放器 | 用户/Agent |
| `music_accepted` | 音乐已锁定 | `music_manifest.json` | 用户/Agent/系统 |
| `beat_locking` | 节拍分析中 | `beats.auto.json` | 系统 |
| `beats_locked` | 节拍锁定完成 | `beats.locked.json` | 系统 |
| `section_mapping` | 段落映射中 | 无 | 系统 |
| `section_ready` | 段落映射完成 | `section_map.json` | 系统 |
| `timing_qa_running` | 时间线审查中 | 无 | LLM Reviewer |
| `scene_planning` | 分镜规划中 | 无 | DeepSeek/LLM |
| `scene_ready` | 分镜完成 | `scene_plan.json`、`caption_plan.json`、`visual_plan.json` | 系统 |
| `hypeframes_generating` | 工程生成中 | HypeFrames 工程文件 | 系统/Codex |
| `hypeframes_qa_running` | 工程文件审查中 | `hypeframes_file_qa_report.json` | QA Gate |
| `rendering_preview` | Preview 渲染中 | 无 | Render Provider |
| `preview_ready` | Preview 可用 | `preview_composite.mp4` | 系统 |
| `render_qa_running` | 渲染结果审查中 | `render_qa_report.json` | QA Gate |
| `export_ready` | 可导出 | `render_manifest.json` | 系统 |
| `failed` | 失败 | `error_report.json` | 系统 |
| `cancelled` | 已取消 | 取消记录 | 用户/Agent |
| `blocked` | 阻断等待人工 | QA 报告 | 用户/管理员 |

---

## 8. 功能需求

## 8.1 账号与 Workspace

### 8.1.1 功能说明

系统支持个人账号与后续团队空间。

### 8.1.2 功能点

| 功能 | 优先级 | 说明 |
|---|---:|---|
| 邮箱/密码登录 | P0 | MVP 基础登录方式。 |
| 第三方登录 | P1 | Google / GitHub 等。 |
| Workspace | P0 | 每个用户默认一个个人空间。 |
| 团队 Workspace | P2 | 企业版或团队版。 |
| API Key 管理 | P1 | Agent 调用使用。 |
| 权限角色 | P1 | Owner / Admin / Member / Agent。 |

### 8.1.3 验收标准

- 用户可创建账号并进入默认 Workspace。
- 每个项目必须归属一个 Workspace。
- 每个积分钱包必须归属一个 Workspace。
- Agent API Key 必须绑定 Workspace 和权限范围。

---

## 8.2 项目创建

### 8.2.1 输入字段

| 字段 | 必填 | 类型 | 说明 |
|---|---:|---|---|
| `topic` | 是 | string | 科普主题。 |
| `duration_target` | 是 | enum | 60 / 90 / 120 / 150 / 180 秒。 |
| `tone` | 是 | enum/string | 严肃、幽默、热血、赛博、课堂、B 站风等。 |
| `audience` | 否 | string | 小学生、大学生、泛科普用户等。 |
| `science_depth` | 否 | enum | 入门 / 中等 / 深入。 |
| `reference_materials` | 否 | file/text/url | 参考资料。 |
| `music_style` | 否 | string | trap、boom bap、drill、lofi、funk 等。 |
| `bpm_hint` | 否 | number | 音乐节奏提示。 |
| `aspect_ratio` | 否 | enum | 默认 9:16。 |
| `platform` | 否 | enum | 抖音 / 快手 / B 站 / 小红书 / TikTok / YouTube Shorts。 |
| `visual_style` | 否 | string | 黑板、赛博、实验室、涂鸦、卡片图解等。 |
| `max_credits` | 否 | number | 本项目最高可消耗积分。 |

### 8.2.2 输出产物

| 产物 | 说明 |
|---|---|
| `project_brief.md` | 人类可读项目简报。 |
| `input_config.json` | 全链路配置源。 |

### 8.2.3 验收标准

- 用户可在 1 个页面内完成项目创建。
- Agent 可通过 1 个 API 请求创建项目。
- 项目创建后进入 `input_ready` 状态。
- 若积分不足以完成最低预估任务，系统应提示充值或降低范围。

---

## 8.3 资料消化

### 8.3.1 功能说明

当用户提供参考资料时，系统调用 DeepSeek 生成结构化事实卡。

### 8.3.2 输入

- 用户上传文件；
- 粘贴文本；
- 链接提取后的正文；
- 项目主题和受众要求。

### 8.3.3 输出

| 文件 | 说明 |
|---|---|
| `facts.json` | 事实卡、术语、类比、禁说项。 |
| `source_notes.md` | 资料摘要和引用备注。 |

### 8.3.4 `facts.json` 逻辑结构

| 字段 | 说明 |
|---|---|
| `core_facts` | 必须表达的核心事实。 |
| `key_terms` | 必须准确使用的术语。 |
| `safe_analogies` | 可用于短视频表达的低误导类比。 |
| `forbidden_claims` | 禁止出现的错误表述。 |
| `angle` | 本视频采用的内容角度。 |
| `source_trace` | 事实来源追踪。 |

### 8.3.5 验收标准

- 有资料时必须输出 `facts.json`。
- 无资料时可跳过该层，但系统需标记为 `facts_source=general_knowledge`。
- 后续歌词、分镜和 QA 均应引用 `facts.json` 或主题配置。

---

## 8.4 歌词生成

### 8.4.1 功能说明

DeepSeek 根据主题、资料、目标时长、语气和音乐风格生成 MiniMax 可用歌词。

### 8.4.2 输出产物

| 文件 | 说明 |
|---|---|
| `lyrics.md` | 可直接传入 MiniMax 的歌词。 |
| `lyrics_structured.json` | 结构化歌词，包括段落、行数、知识点映射。 |
| `music_prompt_options.json` | 3-5 个音乐 prompt 候选。 |

### 8.4.3 歌词结构要求

| 项 | 要求 |
|---|---|
| 标签 | 使用 MiniMax 兼容的结构标签。 |
| Verse | 多段 Verse 重复 `[Verse]`，不写 `[Verse 1]`。 |
| Chorus | 若重复出现，应尽量复用同一段副歌。 |
| 行长 | 中文歌词短句化，避免过长。 |
| 信息密度 | 每段只承载有限科普信息。 |
| 格式 | 不带 Markdown 代码块，不带模型分析过程。 |

### 8.4.4 验收标准

- 歌词必须可被结构化解析。
- 歌词必须包含科普主题核心表达。
- 歌词长度必须符合 MiniMax 调用限制和目标时长策略。
- 若存在事实资料，歌词不得明显违背 `facts.json`。

---

## 8.5 自动歌词 QA Gate

### 8.5.1 功能说明

歌词 QA Gate 不是主观审美评价，而是用于减少后续失败的自动门禁。

### 8.5.2 审查类型

| 审查 | 执行方 | 内容 |
|---|---|---|
| 硬规则审查 | 规则校验器 | 标签、行数、字符数、格式污染、重复副歌。 |
| 事实一致性审查 | LLM Reviewer | 是否偏离 `facts.json`。 |
| 可唱性初筛 | LLM Reviewer | 术语是否过密、句子是否过长。 |
| 风险表达审查 | LLM Reviewer | 是否出现误导性、绝对化或伪科学表述。 |

### 8.5.3 输出

| 文件 | 说明 |
|---|---|
| `lyrics_qa_report.json` | 审查结果。 |
| `lyrics_revision_notes.md` | 自动返修记录。 |

### 8.5.4 状态

| 状态 | 后续动作 |
|---|---|
| `pass` | 进入 MiniMax。 |
| `pass_with_warnings` | 进入 MiniMax，并记录风险。 |
| `auto_fix` | 自动返修一次后复审。 |
| `human_required` | 停止，等待用户或管理员确认。 |
| `blocked` | 阻断，不允许继续生成音乐。 |

---

## 8.6 MiniMax Music 生成

### 8.6.1 功能说明

系统将歌词和用户选择的音乐 prompt 一并提交给 MiniMax Music。

### 8.6.2 输入

| 输入 | 说明 |
|---|---|
| `lyrics.md` | 已通过 QA 的歌词。 |
| `music_prompt` | 用户选择或 Agent 提交的音乐风格提示。 |
| `voice_setting` | 可选，人声设置。 |
| `model_setting` | 模型版本与参数。 |
| `lyrics_optimizer` | 默认关闭，以避免改写歌词结构。 |

### 8.6.3 输出

| 文件 | 说明 |
|---|---|
| `minimax_rap_raw.mp3` | 原始音频。 |
| `minimax_request_manifest.json` | 请求字段、模型版本、prompt、lyrics hash。 |
| `music_generation_notes.md` | 生成说明和异常记录。 |

### 8.6.4 验收标准

- 音频生成成功后必须立即下载到系统存储。
- 系统不得依赖临时 URL 作为长期资产。
- 每次生成都必须记录 prompt、歌词版本、模型版本和返回信息。
- 用户不喜欢但音频生成成功，不默认退款；重新生成另计积分。

---

## 8.7 音乐试听与接受

### 8.7.1 功能说明

用户或 Agent 需要确认是否接受当前音乐。

### 8.7.2 人类 UI

页面包含：

- 音频播放器；
- 歌词展示；
- music prompt 展示；
- 消耗积分；
- 重新生成按钮；
- 接受音乐按钮；
- 版本列表。

### 8.7.3 Agent 策略

Agent 可配置：

| 字段 | 说明 |
|---|---|
| `auto_approve_music` | 是否自动接受第一版音乐。 |
| `max_music_attempts` | 最大音乐生成次数。 |
| `music_acceptance_policy` | 接受策略，如“只要生成成功即接受”。 |

### 8.7.4 验收标准

- 用户接受音乐后，系统进入 `music_accepted`。
- Agent 若开启自动接受，音乐成功后自动进入视频链路。
- 重新生成必须新建版本，并单独计费。

---

## 8.8 Music Lock / Audio Ingest

### 8.8.1 功能说明

这是从音乐生成进入视频编排的边界层。后续所有视频时间线以锁定音频为准。

### 8.8.2 输出

| 文件 | 说明 |
|---|---|
| `minimax_rap_master.wav` | HypeFrames 与剪映使用的主音频。 |
| `minimax_rap_analysis.wav` | 节拍分析用音频。 |
| `music_manifest.json` | 音频时长、hash、版本、路径、响度。 |

### 8.8.3 验收标准

- 必须记录音频实际时长。
- 必须记录音频 hash。
- 后续 `section_map` 和视频渲染不得使用目标时长作为最终真值。
- 若音频损坏或下载失败，必须进入失败状态并退款或释放冻结积分。

---

## 8.9 Beat Lock

### 8.9.1 功能说明

系统自动分析最终音频，生成节拍和小节线。

### 8.9.2 输出

| 文件 | 说明 |
|---|---|
| `beats.auto.json` | 自动检测结果。 |
| `beats.locked.json` | 视频编排唯一节拍真值。 |
| `beat_diagnostics.md` | 节拍稳定性说明。 |

### 8.9.3 审查维度

| 维度 | 要求 |
|---|---|
| BPM 稳定 | 检测 BPM 不应明显冲突。 |
| Beat grid 稳定 | 拍间距波动处于可接受范围。 |
| Downbeat 可信 | 第一重拍候选置信度足够。 |
| Bar 连续 | 小节线覆盖主要音频区间。 |
| Section 合理 | 能与歌词结构大致对应。 |

### 8.9.4 验收标准

- 每个视频项目只能有一个当前有效的 `beats.locked.json`。
- 若低置信度，系统进入 `needs_review` 或自动重试分析。
- HypeFrames 所有节拍动画必须读取 `beats.locked.json`。

---

## 8.10 Section Mapping

### 8.10.1 功能说明

将歌词结构映射到真实音频时间轴。

### 8.10.2 输入

| 输入 | 说明 |
|---|---|
| `lyrics_structured.json` | 歌词段落结构。 |
| `beats.locked.json` | 节拍与小节线。 |
| `music_manifest.json` | 音频时长和版本真值。 |

### 8.10.3 输出

| 文件 | 说明 |
|---|---|
| `section_map.json` | Intro / Verse / Chorus 等段落时间码。 |
| `section_density_report.json` | 每段信息密度和画面承载风险。 |

### 8.10.4 映射原则

1. Scene start 优先落在小节线。
2. Hook / Chorus 入口必须落在小节线。
3. Verse 内知识点切分优先按 4 小节或 8 小节。
4. 不按歌词每一行硬切画面。
5. 画面信息密度不得跟随 Rap 字速无限上升。

---

## 8.11 Timing QA Gate

### 8.11.1 功能说明

LLM 不负责听音频找拍，而是负责审查结构文件是否一致。

### 8.11.2 审查对象

| 文件 | 审查重点 |
|---|---|
| `music_manifest.json` | 音频时长和版本是否清楚。 |
| `beats.locked.json` | 节拍是否可用于主时间线。 |
| `section_map.json` | 段落时间是否合理。 |
| `lyrics_structured.json` | 歌词结构是否被正确映射。 |
| `section_density_report.json` | 信息密度是否超载。 |

### 8.11.3 输出

| 文件 | 说明 |
|---|---|
| `timing_qa_report.json` | 时间线审查结果。 |

---

## 8.12 视频分镜规划

### 8.12.1 功能说明

DeepSeek 或其他 LLM 根据事实、歌词、section_map、beats 生成视频分镜计划。

### 8.12.2 输出

| 文件 | 说明 |
|---|---|
| `scene_plan.json` | 场景计划。 |
| `caption_plan.json` | 字幕与关键词计划。 |
| `visual_plan.json` | 图解组件与画面元素计划。 |

### 8.12.3 分镜原则

| 原则 | 说明 |
|---|---|
| 一段一目标 | 每个 scene 只服务一个明确科普目标。 |
| 画面解释机制 | 优先流程图、因果图、对照图、误区纠正、计数器。 |
| 字幕短句化 | 屏幕文字避免满屏。 |
| 节拍 cue 克制 | 只标注重要视觉动作，不逐字逐拍乱动。 |
| 背景服务图解 | 不用纯氛围背景替代科普解释。 |

---

## 8.13 Scene QA Gate

### 8.13.1 功能说明

确保视频不是“氛围 MV”，而是能辅助理解的科普视频。

### 8.13.2 审查维度

| 维度 | 判断标准 |
|---|---|
| 科普性 | 画面是否解释机制、关系、误区或数字。 |
| 一致性 | 歌词讲的内容是否与画面一致。 |
| 可读性 | 字幕和标签是否足够短、停留足够久。 |
| 节奏性 | 动作是否落在 beat / bar，而非随机动。 |
| 安全区 | 关键文字是否避开平台 UI 遮挡。 |
| 风格一致 | 是否保持统一模板和视觉语言。 |

### 8.13.3 输出

| 文件 | 说明 |
|---|---|
| `scene_qa_report.json` | 分镜审查结果。 |
| `scene_revision_notes.md` | 自动返修说明。 |

---

## 8.14 HypeFrames 工程生成

### 8.14.1 功能说明

HypeFrames 是主时间线和主视觉编排系统。

### 8.14.2 职责

| 职责 | 说明 |
|---|---|
| 生成主 composition | 默认 9:16 竖屏画布。 |
| 生成场景片段 | 按 `section_map.json` 放置 scene。 |
| 生成图解层 | 按 `visual_plan.json` 生成节点、箭头、卡片、计数器。 |
| 生成字幕层 | 按 `caption_plan.json` 生成歌词字幕和关键词字幕。 |
| 生成节拍动画 | 所有 cue 读取 `beats.locked.json`。 |
| 生成输出模式 | preview / review / overlay / caption / background。 |

### 8.14.3 输出

| 文件/目录 | 说明 |
|---|---|
| `index.html` | HypeFrames 主入口。 |
| `styles.css` | 视觉样式。 |
| `compositions/` | 可复用 scene 组件。 |
| `render_targets.json` | 输出模式定义。 |

### 8.14.4 轨道规范

| 轨道 | 内容 | Preview | Overlay | 剪映中是否可动 |
|---:|---|---:|---:|---|
| 0 | 背景底色 | 是 | 否 | 可替换 |
| 10 | 背景视频 / B-roll | 是 | 否 | 可替换 |
| 20 | 科普主图解 | 是 | 是 | 不建议 |
| 30 | 关键词卡片 | 是 | 是 | 不建议 |
| 40 | 歌词字幕 | 是 | 可选 | 可替换但不建议重打轴 |
| 50 | 节拍强调元素 | 是 | 是 | 不建议 |
| 90 | QA 辅助标记 | Review only | 否 | 不进剪映 |

---

## 8.15 HypeFrames File QA Gate

### 8.15.1 功能说明

在渲染前审查 HypeFrames 工程文件是否可复现、可渲染、节拍稳定。

### 8.15.2 审查对象

| 文件 | 审查重点 |
|---|---|
| `index.html` | composition 定义是否完整。 |
| `styles.css` | 安全区、字体、层级是否合理。 |
| `render_targets.json` | 输出模式是否完整。 |
| `beats.locked.json` | cue 时间是否来自唯一节拍真值。 |
| `scene_plan.json` | scene 时间是否对齐 bars。 |
| `caption_plan.json` | 字幕是否过密。 |

### 8.15.3 输出

| 文件 | 说明 |
|---|---|
| `hypeframes_file_qa_report.json` | 文件审查结果。 |
| `hypeframes_revision_notes.md` | 自动修正记录。 |

---

## 8.16 Preview 渲染

### 8.16.1 第一交付物

`preview_composite.mp4`

### 8.16.2 内容

| 内容 | 是否包含 |
|---|---:|
| MiniMax 音频 | 是 |
| 背景视觉 | 是 |
| 科普图解 | 是 |
| 字幕 | 是 |
| 关键词动画 | 是 |
| 节拍强调 | 是 |
| 审核辅助线 | 否 |

### 8.16.3 用途

1. 用户主预览文件；
2. 自动 Render QA 的主视频文件；
3. 剪映包装时的整体参照；
4. 用户不需要分层时的最终包装基础。

---

## 8.17 Review 渲染

### 8.17.1 输出物

`preview_composite_review.mp4`

### 8.17.2 相比 Preview 增加内容

| 辅助元素 | 作用 |
|---|---|
| 时间码 | 快速定位问题。 |
| 小节编号 | 检查 bar 对齐。 |
| Section 名称 | 检查段落映射。 |
| Beat marker | 检查视觉 cue 是否卡拍。 |
| 安全区 | 检查字幕遮挡风险。 |
| 字幕边界 | 检查文本溢出。 |

### 8.17.3 验收标准

- Review 文件只用于内部 QA。
- Review 文件不得进入剪映或对外发布。

---

## 8.18 Render QA Gate

### 8.18.1 功能说明

渲染后对文件、时长、画面关键帧、字幕和透明层进行自动审查。

### 8.18.2 审查维度

| 维度 | 审查内容 |
|---|---|
| 文件存在 | 所有预期产物是否生成。 |
| 时长一致 | 视频时长是否等于主音频时长。 |
| 音频一致 | Preview 是否包含正确音频。 |
| 帧率一致 | 是否使用项目设定 fps。 |
| 关键帧审查 | Scene start、hook、chorus 等位置截图是否合理。 |
| 字幕审查 | 是否遮挡、溢出、过密。 |
| 科普审查 | 是否出现空泛氛围画面替代解释图。 |
| 透明通道 | Overlay / caption alpha 是否有效。 |

### 8.18.3 输出

| 文件 | 说明 |
|---|---|
| `render_qa_report.json` | 渲染审查结果。 |
| `keyframes_contact_sheet.jpg` | 关键帧合集。 |
| `master_qa_report.json` | 全链路总审查结论。 |

---

## 8.19 分层资产与剪映交接

### 8.19.1 输出顺序

1. `preview_composite.mp4`
2. `preview_composite_review.mp4`
3. `overlay_full_alpha.mov`
4. `captions_alpha.mov`
5. `bg_clean.mp4`
6. `capcut_handoff_pack/`

### 8.19.2 剪映轻量方案

使用 `preview_composite.mp4` 作为主视频。

剪映只做：

- 加封面；
- 加片头模板；
- 加片尾关注引导；
- 加贴纸；
- 加平台热梗特效；
- 加统一滤镜；
- 导出发布。

### 8.19.3 标准方案 B

使用分层资产。

| 剪映轨道 | 内容 |
|---:|---|
| 5 | 剪映模板、贴纸、平台特效 |
| 4 | `overlay_full_alpha.mov` |
| 3 | `captions_alpha.mov` 或 `captions.srt` |
| 2 | 可选剪映背景模板 |
| 1 | `bg_clean.mp4` |
| 音轨 1 | `minimax_rap_master.wav` |

### 8.19.4 不建议操作

- 移动主音轨；
- 移动透明叠层；
- 重新打字幕时间轴；
- 重新卡点；
- 重做知识图解；
- 修改 HypeFrames 已锁定的主节奏。

---

## 9. Agent 自动化需求

### 9.1 Agent 类型

| 类型 | 说明 |
|---|---|
| Browser Agent | 通过网页模拟人类操作，作为兼容能力。 |
| API Agent | 通过 Agent API 执行项目创建、生成、查询、导出。 |
| Goal Agent | 提交完整目标、预算、授权，由系统内部自动跑完整工作流。 |

MVP 优先支持 API Agent。

---

### 9.2 Agent Run 输入

| 字段 | 必填 | 说明 |
|---|---:|---|
| `goal` | 是 | 任务目标。 |
| `topic` | 是 | 科普主题。 |
| `materials` | 否 | 资料文本、文件或链接。 |
| `style` | 否 | 音乐和视频风格。 |
| `duration_target` | 是 | 目标时长。 |
| `aspect_ratio` | 否 | 默认 9:16。 |
| `max_credits` | 是 | 最高消耗积分。 |
| `auto_approve_music` | 否 | 是否自动接受音乐。 |
| `max_music_attempts` | 否 | 音乐最大生成次数。 |
| `render_quality` | 否 | preview / standard / hd。 |
| `callback_url` | 否 | 完成或异常通知地址。 |

---

### 9.3 Agent Run 输出

| 字段 | 说明 |
|---|---|
| `agent_run_id` | Agent 任务 ID。 |
| `project_id` | 项目 ID。 |
| `status` | running / completed / failed / blocked。 |
| `current_step` | 当前执行步骤。 |
| `credits_reserved` | 已冻结积分。 |
| `credits_spent` | 已实际消耗积分。 |
| `artifacts` | 当前已生成资产。 |
| `next_action_required` | 是否需要人工或 Agent 决策。 |
| `error_code` | 错误码。 |
| `report_url` | QA 或最终报告。 |

---

### 9.4 Agent 权限

| 权限 | 说明 |
|---|---|
| `project:create` | 创建项目。 |
| `material:upload` | 上传资料。 |
| `lyrics:generate` | 生成歌词。 |
| `music:generate` | 生成音乐。 |
| `music:approve` | 接受音乐。 |
| `video:generate` | 生成视频。 |
| `render:start` | 开始渲染。 |
| `export:download` | 下载导出结果。 |
| `billing:read` | 查询积分余额和消耗。 |
| `run:cancel` | 取消任务。 |

---

### 9.5 Agent 风控

| 限制 | 说明 |
|---|---|
| 单项目预算 | 防止一个项目无限重试。 |
| 单日预算 | 防止 Agent 失控烧分。 |
| 单任务最大重试 | 防止循环执行。 |
| 高价动作确认 | 高清渲染、批量生成需额外授权。 |
| 自动接受开关 | 控制是否允许 Agent 跳过人类试听。 |
| 并发限制 | 控制同时运行任务数。 |
| 审计日志 | 记录 Agent 每一步操作和消耗。 |

---

## 10. 积分系统

### 10.1 设计目标

积分系统用于：

1. 控制用户和 Agent 的模型调用、音乐生成、渲染、导出成本；
2. 支持预估、冻结、结算、退款；
3. 支持账务审计；
4. 支持套餐、充值包和后续企业版；
5. 防止 Agent 自动化失控。

---

### 10.2 核心对象

| 对象 | 说明 |
|---|---|
| `wallet` | 当前可用积分。 |
| `credit_ledger` | 所有积分流水。 |
| `credit_hold` | 任务开始前的冻结积分。 |
| `credit_settlement` | 任务成功后的结算记录。 |
| `refund_record` | 失败、取消或系统错误退款记录。 |
| `agent_budget` | Agent 预算配置。 |
| `pricing_rule` | 各动作积分定价规则。 |

---

### 10.3 计费动作

| 动作 | 计费建议 |
|---|---|
| 资料解析 | 免费或低积分。 |
| 事实卡生成 | 低积分。 |
| 歌词生成 | 低积分。 |
| 歌词自动返修 | 按次数或免费一次。 |
| MiniMax Music 生成 | 高积分。 |
| 音乐重新生成 | 每次扣费。 |
| Beat lock | 低或中积分。 |
| Section mapping | 低积分。 |
| 视频分镜生成 | 中积分。 |
| HypeFrames 工程生成 | 中积分。 |
| Preview 渲染 | 中高积分。 |
| 分层资产渲染 | 高积分。 |
| 高清导出 | 可额外计费。 |
| 长期存储 | 可按月计费。 |
| Agent 自动执行 | 可作为企业版权益或加服务费。 |

---

### 10.4 冻结与结算流程

```text
estimate → hold → execute → settle/refund
```

| 阶段 | 说明 |
|---|---|
| Estimate | 系统预估本动作消耗。 |
| Hold | 冻结积分，防止余额被其他任务占用。 |
| Execute | 执行模型调用、音乐生成或渲染。 |
| Settle | 成功后扣除实际积分。 |
| Refund | 失败、取消或系统错误时退回全部或部分冻结积分。 |

---

### 10.5 退款规则

| 场景 | 积分处理 |
|---|---|
| DeepSeek 调用失败 | 释放冻结积分。 |
| 歌词格式错误但自动修复成功 | 不额外扣，或免费一次。 |
| MiniMax 生成失败 | 释放或退回冻结积分。 |
| MiniMax 成功但用户不喜欢 | 不退款。 |
| 视频渲染系统失败 | 退回渲染积分。 |
| 用户主动取消 | 未执行部分退回，已执行部分不退。 |
| Agent 超预算 | 停止后续动作，不继续扣费。 |
| Provider 超时但未产生结果 | 释放冻结积分。 |

---

## 11. 管理后台

### 11.1 功能模块

| 模块 | 说明 |
|---|---|
| 用户管理 | 查看用户、Workspace、余额、状态。 |
| 项目管理 | 查看项目状态、资产、失败原因。 |
| 任务管理 | 查看 StepRun，重试失败任务。 |
| 积分管理 | 查看账本、冻结、结算、退款。 |
| Provider 管理 | 查看 DeepSeek、MiniMax、HypeFrames、渲染成本和失败率。 |
| Agent 管理 | 查看 Agent 权限、预算、日志。 |
| 模板管理 | 管理视频模板、字幕模板、音乐风格模板。 |
| QA 报告 | 查看各 Gate 报告和主审查结论。 |
| 系统配置 | 限流、并发、定价、存储策略。 |

---

### 11.2 管理后台验收标准

- 管理员可按项目 ID 查询全链路资产和日志。
- 管理员可看到每一步积分冻结与结算。
- 管理员可对失败任务执行重试或退款。
- 管理员可禁用异常 Agent 或用户。
- 管理员可查看每日模型成本和生成成功率。

---

## 12. 数据对象模型

### 12.1 `Workspace`

| 字段 | 说明 |
|---|---|
| `workspace_id` | 空间 ID。 |
| `name` | 空间名称。 |
| `owner_user_id` | 所有人。 |
| `wallet_id` | 积分钱包。 |
| `plan_type` | free / paid / enterprise。 |
| `created_at` | 创建时间。 |

---

### 12.2 `Project`

| 字段 | 说明 |
|---|---|
| `project_id` | 项目 ID。 |
| `workspace_id` | 所属空间。 |
| `title` | 项目标题。 |
| `topic` | 科普主题。 |
| `duration_target` | 目标时长。 |
| `actual_audio_duration` | 音频实际时长。 |
| `audience` | 目标受众。 |
| `tone` | 语气。 |
| `visual_style` | 画面风格。 |
| `workflow_state` | 当前状态。 |
| `created_by_type` | human / agent / system。 |
| `created_by_id` | 创建者 ID。 |
| `budget_limit` | 项目预算。 |
| `credits_spent` | 已消耗积分。 |
| `created_at` | 创建时间。 |
| `updated_at` | 更新时间。 |

---

### 12.3 `StepRun`

| 字段 | 说明 |
|---|---|
| `step_run_id` | 任务 ID。 |
| `project_id` | 所属项目。 |
| `step_type` | lyric / music / beat_lock / scene / render / export 等。 |
| `provider` | DeepSeek / MiniMax / HypeFrames / Render Provider。 |
| `status` | pending / running / succeeded / failed / cancelled。 |
| `input_artifact_ids` | 输入资产。 |
| `output_artifact_ids` | 输出资产。 |
| `credit_hold_id` | 冻结记录。 |
| `credit_settlement_id` | 结算记录。 |
| `error_code` | 错误码。 |
| `retry_count` | 重试次数。 |
| `started_at` | 开始时间。 |
| `finished_at` | 结束时间。 |

---

### 12.4 `Artifact`

| 字段 | 说明 |
|---|---|
| `artifact_id` | 资产 ID。 |
| `project_id` | 所属项目。 |
| `artifact_type` | facts / lyrics / audio / beats / scene / video / report 等。 |
| `version` | 版本号。 |
| `storage_path` | 存储路径。 |
| `mime_type` | 文件类型。 |
| `hash` | 文件 hash。 |
| `metadata` | 时长、尺寸、模型、prompt、fps 等。 |
| `created_by` | human / agent / system。 |
| `linked_step_run_id` | 生成该资产的任务。 |
| `created_at` | 创建时间。 |

---

### 12.5 `AgentAccount`

| 字段 | 说明 |
|---|---|
| `agent_id` | Agent ID。 |
| `workspace_id` | 所属空间。 |
| `name` | Agent 名称。 |
| `api_key_hash` | API Key hash。 |
| `permissions` | 权限集合。 |
| `budget_daily` | 每日预算。 |
| `budget_per_project` | 单项目预算。 |
| `max_retries` | 最大重试次数。 |
| `auto_approve_music` | 是否允许自动接受音乐。 |
| `auto_export` | 是否允许自动导出。 |
| `webhook_url` | 回调地址。 |
| `status` | active / disabled。 |

---

## 13. 标准文件目录

```text
project_root/
  input/
    project_brief.md
    input_config.json
    source_notes.md
  data/
    facts.json
    lyrics.md
    lyrics_structured.json
    music_prompt_options.json
    beats.auto.json
    beats.locked.json
    section_map.json
    section_density_report.json
    scene_plan.json
    caption_plan.json
    visual_plan.json
  audio/
    minimax_rap_raw.mp3
    minimax_rap_master.wav
    minimax_rap_analysis.wav
    music_manifest.json
  hypeframes/
    index.html
    styles.css
    render_targets.json
    compositions/
  qa/
    lyrics_qa_report.json
    timing_qa_report.json
    scene_qa_report.json
    hypeframes_file_qa_report.json
    render_qa_report.json
    master_qa_report.json
  dist/
    preview_composite.mp4
    preview_composite_review.mp4
    overlay_full_alpha.mov
    captions_alpha.mov
    bg_clean.mp4
    final_publish.mp4
  capcut_handoff_pack/
    captions.srt
    beat_markers.csv
    section_markers.csv
    render_manifest.json
  archive/
```

---

## 14. 标准输出产物

### 14.1 数据产物

| 文件 | MVP 必需 | 用途 |
|---|---:|---|
| `input_config.json` | 是 | 项目配置。 |
| `facts.json` | 有资料时必需 | 事实依据。 |
| `lyrics.md` | 是 | MiniMax 歌词。 |
| `lyrics_structured.json` | 是 | 歌词结构化。 |
| `music_manifest.json` | 是 | 音频版本真值。 |
| `beats.auto.json` | 是 | 自动节拍检测结果。 |
| `beats.locked.json` | 是 | 视频时间线唯一节拍真值。 |
| `section_map.json` | 是 | 歌词段落到音频时间映射。 |
| `scene_plan.json` | 是 | 视频分镜。 |
| `caption_plan.json` | 是 | 字幕与关键词。 |
| `visual_plan.json` | 是 | 图解与视觉组件。 |

---

### 14.2 QA 产物

| 文件 | MVP 必需 | 用途 |
|---|---:|---|
| `lyrics_qa_report.json` | 是 | 歌词审查。 |
| `timing_qa_report.json` | 是 | 时间线审查。 |
| `scene_qa_report.json` | 是 | 分镜审查。 |
| `hypeframes_file_qa_report.json` | 是 | HypeFrames 工程审查。 |
| `render_qa_report.json` | 是 | 渲染审查。 |
| `master_qa_report.json` | 是 | 总审查结论。 |

---

### 14.3 视频产物

| 文件 | MVP 必需 | 用途 |
|---|---:|---|
| `preview_composite.mp4` | 是 | 第一交付物，完整预览合成版。 |
| `preview_composite_review.mp4` | 是 | 内部审查版。 |
| `overlay_full_alpha.mov` | 否 | 剪映透明图解叠层。 |
| `captions_alpha.mov` | 否 | 剪映透明字幕层。 |
| `bg_clean.mp4` | 否 | 干净背景层。 |
| `final_publish.mp4` | 否 | 剪映导出的最终发布版。 |

---

## 15. QA Gate 总表

| Gate | 输入 | 主要审查 | 通过后进入 | MVP |
|---|---|---|---|---:|
| Lyrics QA | `lyrics.md` / `facts.json` | 结构、事实、可唱性、格式 | MiniMax 生成 | 是 |
| Music Ingest QA | MiniMax 音频 | 时长、hash、下载、响度 | 节拍分析 | 是 |
| Beat Lock QA | `beats.auto.json` | BPM、beat、bar、downbeat 置信度 | Section mapping | 是 |
| Timing QA | `beats.locked.json` / `section_map.json` | 段落时间、信息密度、hook 对齐 | 分镜规划 | 是 |
| Scene QA | `scene_plan.json` | 科普性、一致性、可读性 | HypeFrames 生成 | 是 |
| HypeFrames File QA | 工程文件 | 文件完整性、时间线、输出模式 | Preview 渲染 | 是 |
| Render QA | 渲染产物 | 时长、音频、关键帧、透明层 | 导出 | 是 |
| Master QA | 全部报告 | 是否可自动通过 | 人工轻量包装 | 是 |

---

## 16. 自动化通过策略

| 状态 | 含义 | 人工是否介入 |
|---|---|---:|
| `auto_approved` | 所有关键 Gate 通过。 | 否 |
| `approved_with_warnings` | 只有轻微警告。 | 通常否 |
| `auto_fixed` | 自动返修后通过。 | 否 |
| `needs_review` | 存在低置信度问题。 | 是 |
| `blocked` | 存在阻断错误。 | 是 |

人工介入阈值：

1. 事实冲突无法自动判断；
2. 节拍检测出现双倍 / 半速严重冲突；
3. 音频时长与歌词结构偏差过大；
4. 透明层无法生成；
5. Preview 合成版缺音频、错时长或明显黑屏；
6. LLM 多次判定画面只有氛围感，没有科普功能；
7. Agent 达到预算或权限边界。

---

## 17. 非功能需求

### 17.1 性能

| 指标 | MVP 目标 |
|---|---|
| 项目创建响应 | 3 秒内返回项目 ID。 |
| 任务状态查询 | 1 秒内返回。 |
| 音乐生成 | 采用异步任务，不阻塞页面。 |
| 视频渲染 | 采用异步队列，不阻塞页面。 |
| Agent API | 支持轮询和 webhook。 |

---

### 17.2 可靠性

| 要求 | 说明 |
|---|---|
| 异步任务可恢复 | Worker 重启后任务状态可恢复。 |
| Provider 调用可追踪 | 每次调用保存 request manifest 和 response 摘要。 |
| 幂等 | Agent 重复请求不得重复扣费或重复触发高成本任务。 |
| 资产持久化 | 生成后立即转存音频和视频资产。 |
| 错误可诊断 | 每个失败步骤必须有错误码和报告。 |

---

### 17.3 安全

| 要求 | 说明 |
|---|---|
| API Key 加密存储 | 不明文保存。 |
| 文件上传限制 | 限制大小、类型、恶意文件。 |
| Prompt injection 防护 | 用户资料作为 untrusted context。 |
| Agent 权限隔离 | Agent 只能执行授权动作。 |
| 积分防刷 | 高成本动作需冻结积分。 |
| 审计日志 | 用户和 Agent 的关键动作都要记录。 |

---

### 17.4 合规与版权提示

MVP 至少提供：

- 生成内容使用条款提示；
- 音乐和视频商用授权提示位；
- 用户上传资料版权责任提示；
- 项目来源和生成记录；
- 敏感主题和违规内容阻断策略预留。

---

## 18. 关键指标

### 18.1 产品指标

| 指标 | 说明 |
|---|---|
| 项目创建数 | 用户创建项目数量。 |
| 首次 Preview 成功率 | 从项目创建到生成 `preview_composite.mp4` 的成功比例。 |
| 平均生成时长 | 从输入到 Preview 可用的平均时间。 |
| 音乐接受率 | 第一版或第 N 版音乐被接受的比例。 |
| 重生成率 | 用户重新生成音乐或视频的比例。 |
| 导出率 | Preview 可用后实际导出的比例。 |
| Agent 完成率 | Agent Run 成功完成比例。 |
| 人工介入率 | 进入 `needs_review` 或 `blocked` 的比例。 |

---

### 18.2 成本指标

| 指标 | 说明 |
|---|---|
| 单 Preview 平均积分消耗 | 每个成功 Preview 的平均积分。 |
| Provider 成本分布 | DeepSeek、MiniMax、渲染等成本占比。 |
| 失败退款率 | 因失败退回的积分比例。 |
| 渲染失败率 | HypeFrames 或渲染任务失败比例。 |
| Agent 超预算率 | Agent 因预算不足暂停的比例。 |

---

## 19. MVP 里程碑

### M0：产品与技术规格确认

交付：

- PRD v0.1；
- Workflow Spec；
- Credit Spec；
- Agent Spec；
- Prompt Schema Spec；
- UI Spec 初稿。

---

### M1：Preview-Only 闭环

目标：从主题输入到 `preview_composite.mp4` 成功输出。

包含：

- 项目创建；
- DeepSeek 资料消化；
- 歌词生成；
- 歌词 QA；
- MiniMax Music；
- 音乐试听/接受；
- 音频锁定；
- Beat lock；
- Section map；
- Scene plan；
- HypeFrames preview；
- Render QA；
- 积分冻结/结算；
- 基础后台。

不做：

- 分层包；
- 批量生成；
- 模板市场；
- 团队协作。

---

### M2：Agent 可用

新增：

- Agent API Key；
- Agent Run；
- Agent 状态查询；
- Webhook；
- Agent 预算；
- Agent 审计日志；
- 自动接受音乐开关；
- 自动导出开关。

---

### M3：标准方案 B

新增：

- `overlay_full_alpha.mov`；
- `captions_alpha.mov`；
- `bg_clean.mp4`；
- `capcut_handoff_pack/`；
- safe area guide；
- 剪映交接说明页。

---

### M4：批量生产与商业化

新增：

- 批量任务队列；
- 模板库；
- 团队空间；
- 套餐订阅；
- 充值包；
- 成本统计；
- API 商业化。

---

## 20. 页面需求

### 20.1 人类 Web UI 页面

| 页面 | 优先级 | 说明 |
|---|---:|---|
| 登录/注册页 | P0 | 基础账号入口。 |
| Dashboard | P0 | 项目列表、余额、最近任务。 |
| 创建项目页 | P0 | 输入主题、资料、风格、预算。 |
| 歌词与 Prompt 页 | P0 | 查看歌词、选择 music prompt。 |
| 音乐试听页 | P0 | 播放、重生成、接受。 |
| 生成进度页 | P0 | 展示当前步骤、耗时、积分。 |
| Preview 播放页 | P0 | 播放 `preview_composite.mp4`。 |
| 导出页 | P0 | 下载 Preview、音频、字幕、报告。 |
| 积分页 | P0 | 余额、充值、流水。 |
| Agent 管理页 | P1 | API Key、权限、预算。 |
| 后台管理页 | P1 | 任务、用户、积分、异常。 |
| 模板管理页 | P2 | 模板选择和配置。 |

---

### 20.2 创建项目页信息架构

| 区块 | 内容 |
|---|---|
| 基础信息 | 标题、主题、目标受众、科普深度。 |
| 时长与平台 | 目标时长、画幅、发布平台。 |
| 音乐偏好 | Rap 风格、语气、BPM 提示。 |
| 资料输入 | 上传资料、粘贴文本、链接。 |
| 视频偏好 | 画面风格、模板、字幕风格。 |
| 成本控制 | 预计积分、项目预算上限。 |
| 提交 | 创建项目并开始生成。 |

---

### 20.3 Preview 播放页

| 区块 | 内容 |
|---|---|
| 视频播放器 | 播放 `preview_composite.mp4`。 |
| 审查摘要 | Master QA 结果。 |
| 版本信息 | 音频版本、歌词版本、渲染版本。 |
| 操作按钮 | 下载、重新渲染、生成分层包、导出剪映包。 |
| 积分信息 | 本项目已消耗积分。 |
| 异常提示 | 展示 warnings 或 blocked 原因。 |

---

## 21. API 需求摘要

> 本节仅定义能力，不定义具体代码实现。

### 21.1 Agent API 能力

| 能力 | 说明 |
|---|---|
| 创建项目 | 提交主题、资料、风格、预算。 |
| 上传资料 | 上传文本或文件。 |
| 启动歌词生成 | 触发 DeepSeek 歌词链路。 |
| 提交音乐 prompt | 选择或自定义 MiniMax prompt。 |
| 启动音乐生成 | 触发 MiniMax。 |
| 接受音乐 | 标记音乐可进入视频链路。 |
| 启动视频生成 | 触发 HypeFrames 链路。 |
| 查询任务状态 | 获取项目当前状态和步骤。 |
| 查询积分 | 获取余额、冻结、消耗。 |
| 下载资产 | 获取 Preview、音频、字幕、报告。 |
| 取消任务 | 停止未完成任务。 |

---

### 21.2 幂等要求

所有高成本 API 必须支持幂等键：

| 场景 | 要求 |
|---|---|
| Agent 重复提交音乐生成 | 同一幂等键不得重复扣费。 |
| Agent 重复触发渲染 | 同一版本已存在结果时直接返回结果。 |
| 网络超时重试 | 不得生成多个重复 StepRun。 |

---

## 22. 风险与降级方案

| 风险 | 表现 | 降级方案 |
|---|---|---|
| MiniMax 音频节拍不稳 | Beat lock 低置信度。 | 重新生成音乐，或改用稳定 prompt。 |
| 音频实际时长偏差大 | 目标 60 秒，实际明显偏离。 | 以音频为准重新 section mapping。 |
| 歌词结构与实际演唱错位 | Section map 不合理。 | 以音频能量和小节重新分段。 |
| 分镜过度复杂 | 观众看不完。 | 降级为 3 点卡片式图解。 |
| 字幕过密 | 屏幕拥挤。 | 拆句、减少屏幕文字、保留关键词。 |
| 透明层异常 | Overlay 无 alpha 或黑底。 | 使用 Preview 作为主视频，剪映只轻包装。 |
| 剪映模板遮挡 | 字幕或图解被盖住。 | 使用 safe area guide 调整模板位置。 |
| LLM 审查误判 | 报告通过但效果差。 | 保留人工快速看 Preview 的最后兜底。 |
| Agent 失控 | 重复生成或超预算。 | 单项目预算、每日预算、并发限制、强制暂停。 |
| Provider API 变化 | 调用失败或字段变更。 | Provider Adapter 抽象层与错误兜底。 |

---

## 23. OpenDesign / Codex 交付边界

### 23.1 OpenDesign 适合负责

| 交付物 | 说明 |
|---|---|
| Web UI 信息架构 | Dashboard、创建页、试听页、Preview 页、导出页。 |
| 视觉系统 | 品牌色、字体、卡片、播放器、状态组件。 |
| 视频模板视觉规范 | 字幕样式、关键词卡片、图解组件、安全区。 |
| 管理后台布局 | 任务表、用户表、积分流水、QA 报告页。 |
| Agent 管理页面 | API Key、权限、预算、日志。 |

---

### 23.2 Codex 适合负责

| 交付物 | 说明 |
|---|---|
| 数据模型 | Project、StepRun、Artifact、CreditLedger、AgentAccount。 |
| Workflow Orchestrator | 状态机、任务队列、重试、失败处理。 |
| Provider Gateway | DeepSeek、MiniMax、HypeFrames、渲染、存储适配。 |
| Credit Service | 冻结、结算、退款、账本。 |
| Agent API | 创建、执行、查询、导出、webhook。 |
| Asset Service | 文件存储、版本、hash、manifest。 |
| QA Gate Runner | 规则校验、LLM reviewer、报告输出。 |
| Admin Console Backend | 管理后台接口。 |

---

## 24. 验收标准总表

### 24.1 MVP 必须通过

| 编号 | 验收标准 |
|---|---|
| A1 | 用户可创建项目并输入主题、资料、目标时长、风格。 |
| A2 | 系统可生成 `facts.json`、`lyrics.md`、`lyrics_structured.json`。 |
| A3 | 歌词 QA Gate 可输出 `lyrics_qa_report.json`。 |
| A4 | 系统可调用 MiniMax 生成并保存音频。 |
| A5 | 用户可试听、接受或重新生成音乐。 |
| A6 | 系统可生成 `music_manifest.json` 并记录音频实际时长和 hash。 |
| A7 | 系统可生成 `beats.locked.json`。 |
| A8 | 系统可生成 `section_map.json`。 |
| A9 | 系统可生成 `scene_plan.json`、`caption_plan.json`、`visual_plan.json`。 |
| A10 | 系统可生成 HypeFrames 工程文件。 |
| A11 | 系统可渲染 `preview_composite.mp4`。 |
| A12 | Render QA 可输出 `master_qa_report.json`。 |
| A13 | 用户可下载 Preview、音频、歌词、QA 报告。 |
| A14 | 积分系统可完成预估、冻结、结算、失败退款。 |
| A15 | Agent 可通过 API 创建项目、查询状态、下载结果。 |
| A16 | 管理员可查看项目、任务、积分流水和失败原因。 |

---

## 25. 后续待定问题

| 问题 | 需要决策 |
|---|---|
| MiniMax 具体模型版本 | MVP 默认模型、fallback 模型。 |
| HypeFrames 部署方式 | 本地渲染、云端渲染或混合。 |
| DeepSeek 输出 schema | 是否严格 JSON Schema 校验。 |
| 定价模型 | 积分与人民币、模型成本、利润率关系。 |
| 版权条款 | 生成音乐和视频的商用授权提示。 |
| Agent API 鉴权 | API Key、OAuth、短期 token。 |
| 文件保留周期 | 免费版和付费版资产保存时间。 |
| 视频模板数量 | MVP 默认 1 个还是 3 个。 |
| 支持平台安全区 | 首批支持抖音/B站/小红书/TikTok 哪些。 |
| 是否允许纯 Agent 全自动发布 | MVP 不建议，后续企业版再考虑。 |

---

## 26. PRD 结论

MVP 应优先实现 **Preview-Only 闭环 + 积分账本 + 基础 Agent API**。

第一阶段不应过度投入复杂剪映分层包、模板市场和批量生产。最重要的是验证以下闭环：

> 主题/资料输入 → 歌词 → 音乐 → 音频锁定 → 节拍真值 → 分镜 → HypeFrames Preview → QA 报告 → 可下载视频。

当 `preview_composite.mp4` 的成功率、生成时长、积分成本和用户接受率稳定后，再进入标准方案 B，即输出分层资产和 `capcut_handoff_pack/`。
