# 最小 Web UI 定义

> 文档版本：v0.1  
> 文档类型：MVP UI Specification  
> 适用范围：科普 Rap 音乐 + 视频 SaaS 的最小可用 Web UI  
> 面向对象：OpenDesign、前端、后端、Codex、产品验收  
> 核心原则：Preview-First、状态机驱动、HypeFrames 主时间线、剪映轻包装、Agent 可观测

---

## 1. 文档目标

本文件定义 MVP 阶段最小 Web UI。目标不是设计完整创作平台，而是提供一套能跑通完整链路的最小界面：

1. 创建科普 Rap 视频项目。
2. 输入主题、资料、风格、时长和画幅。
3. 查看 DeepSeek 输出的事实卡、歌词结构、歌词和音乐提示词。
4. 生成并试听 MiniMax Music 音乐。
5. 接受音乐并触发 HypeFrames 视频预览渲染。
6. 查看 `preview_composite.mp4`、QA 结果和导出资产。
7. 管理积分消耗、失败重试和人工介入点。

MVP Web UI 只承载人类操作与审片，不负责复杂模板市场、多人协作、细粒度视频编辑或剪映内时间线编辑。

---

## 2. 设计原则

| 原则 | 说明 |
|---|---|
| Preview-First | UI 的第一核心目标是让用户尽快看到 `preview_composite.mp4`。 |
| 状态机驱动 | 页面按钮、进度、禁用态、错误态全部来自后端工作流状态机。 |
| 成本显性 | 高成本动作必须展示预计积分、冻结积分和失败退款规则。 |
| 中间产物可见 | 歌词、音乐 prompt、音频、分镜、QA 报告、视频都应可查看。 |
| 不做主观强校验 | 系统不替用户判断“好不好听”，只展示客观 QA 与风险。 |
| Agent 一致性 | 人类 UI 展示的项目状态必须与 Agent API 看到的状态一致。 |
| 最小可审计 | 每个按钮触发的 StepRun、积分变动、产物版本都要可追踪。 |

---

## 3. MVP 用户角色

| 角色 | UI 权限 | 说明 |
|---|---|---|
| Creator | 创建项目、生成歌词、生成音乐、接受音乐、渲染、导出 | 普通人类创作者。 |
| Operator | 查看所有项目、处理 `needs_review`、重试失败任务 | 运营/内部审核人员。 |
| Admin | 管理积分、用户、任务、Provider 状态 | MVP 可简化为内部后台页面。 |
| Agent | 主要通过 API 操作；Web UI 只展示其 Run 状态 | 不要求 Agent 通过 UI 点按钮，但 UI 应能查看 Agent 执行结果。 |

---

## 4. 最小页面地图

MVP 只需要以下 7 个页面或页面级模块。

| 页面 | 路由建议 | 必需 | 作用 |
|---|---|---:|---|
| 登录/工作区选择 | `/login`、`/workspaces` | 是 | 登录、选择 Workspace。 |
| 项目列表 | `/projects` | 是 | 查看项目、状态、余额、创建新项目。 |
| 项目创建向导 | `/projects/new` | 是 | 输入主题、资料、风格、时长、画幅和预算。 |
| 项目工作台 | `/projects/{id}` | 是 | 所有核心状态与产物的主界面。 |
| 音乐试听确认 | `/projects/{id}/music` | 可作为工作台 Tab | 试听、重生成、接受音乐。 |
| 视频预览与 QA | `/projects/{id}/video` | 可作为工作台 Tab | 查看 Preview、Review、QA 报告和关键帧。 |
| 导出与交接包 | `/projects/{id}/export` | 可作为工作台 Tab | 下载 MP4、音频、字幕、剪映交接包。 |
| 最小后台 | `/admin` | P1，但建议 MVP 内部可用 | 查看任务、积分、失败日志。 |

---

## 5. 项目列表页

### 5.1 页面目标

让用户快速判断：

1. 哪些项目已完成；
2. 哪些项目需要人工处理；
3. 哪些项目正在消耗积分；
4. 哪些项目由 Agent 创建；
5. 余额是否足够继续生成。

### 5.2 页面元素

| 元素 | 必需 | 说明 |
|---|---:|---|
| Workspace 名称 | 是 | 当前工作区。 |
| 积分余额 | 是 | 当前可用积分、冻结积分。 |
| 创建项目按钮 | 是 | 进入项目创建向导。 |
| 项目卡片/表格 | 是 | 显示项目标题、状态、最后更新时间、消耗积分。 |
| 状态过滤器 | 是 | All / Running / Needs Review / Ready / Failed。 |
| Agent 标识 | 是 | 标记项目是否由 Agent 创建。 |
| 最近失败原因 | 是 | 项目失败时显示简短错误。 |

### 5.3 项目卡片字段

| 字段 | 说明 |
|---|---|
| 标题 | 项目标题或主题。 |
| 当前状态 | 来自工作流状态机。 |
| 当前步骤 | 如 `music_generating`、`preview_rendering`。 |
| 预览缩略图 | 有 `preview_composite.mp4` 后显示。 |
| 积分 | 已花费 / 已冻结 / 预算上限。 |
| 创建者 | Human / Agent。 |
| 最近操作 | 最近一次 StepRun 的结束时间和结果。 |

---

## 6. 项目创建向导

### 6.1 向导定位

只收集启动工作流所需的最小信息，不把所有高级参数暴露给用户。

### 6.2 输入字段

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| 科普主题 | 是 | 无 | 如“黑洞为什么不是洞”。 |
| 参考资料 | 否 | 空 | 文本、链接、PDF、Markdown。 |
| 目标时长 | 是 | 60 秒 | 60 / 90 / 120 / 150 / 180 秒档位。 |
| 目标受众 | 是 | 泛科普用户 | 小学生、初中生、大学生、泛科普、专业入门。 |
| 语气风格 | 是 | 幽默清晰 | 严肃、热血、幽默、赛博、课堂感等。 |
| Rap 风格 | 是 | 中文 trap | trap、boom bap、lo-fi、funk、pop rap 等。 |
| 画幅 | 是 | 9:16 | 9:16、16:9、1:1。MVP 优先 9:16。 |
| 发布平台 | 否 | 抖音/视频号通用 | 控制安全区和字幕大小。 |
| 项目预算 | 是 | 系统建议 | 限制本项目最大积分消耗。 |
| 自动推进 | 是 | 关闭 | 是否允许系统在 QA 通过后自动进入下一步。 |

### 6.3 提交前校验

| 校验 | 阻断 | 说明 |
|---|---:|---|
| 主题为空 | 是 | 必须有明确主题。 |
| 目标时长非法 | 是 | 必须属于支持档位。 |
| 预算低于最低预估 | 是 | 防止创建后无法执行。 |
| 参考资料过大 | 是 | 提示压缩或分段上传。 |
| 资料格式不支持 | 是 | 提示支持格式。 |
| 资料为空但用户选择“基于资料” | 是 | 要求补充资料或改为无资料路径。 |

### 6.4 提交后结果

成功创建后进入项目工作台，项目状态为：

`draft` → `material_ready` → 可触发 `facts_generating` 或 `lyrics_generating`

---

## 7. 项目工作台

### 7.1 页面结构

项目工作台是 MVP 的主页面。推荐采用以下结构：

| 区域 | 内容 |
|---|---|
| 顶部栏 | 项目标题、状态、预算、已花费积分、创建者、导出按钮。 |
| 左侧进度栏 | 工作流步骤：输入、歌词、音乐、节拍、分镜、HypeFrames、Preview、导出。 |
| 中央内容区 | 当前步骤的主内容。 |
| 右侧资产栏 | 已生成资产、版本、下载入口。 |
| 底部日志栏 | 最近 StepRun、错误、QA 摘要。 |

### 7.2 必需 Tab

| Tab | 作用 |
|---|---|
| Brief | 查看输入配置、项目简报和资料摘要。 |
| Lyrics | 查看事实卡、歌词结构、歌词、MiniMax prompt 候选。 |
| Music | 生成、试听、重生成、接受音乐。 |
| Video | 查看 HypeFrames Preview、Review、关键帧和渲染状态。 |
| QA | 汇总所有 QA Gate 报告。 |
| Export | 下载成片、音频、字幕、剪映交接包。 |
| Logs | 查看 StepRun、错误、积分流水简表。 |

---

## 8. Lyrics Tab

### 8.1 目标

让用户确认 DeepSeek 产出的内容是否可以进入 MiniMax Music。

### 8.2 展示内容

| 区块 | 内容 |
|---|---|
| 事实卡 | 有资料时显示 `facts.json` 摘要。 |
| 歌词结构 | Intro / Verse / Chorus / Bridge / Outro。 |
| 歌词正文 | `lyrics.md`。 |
| 音乐 prompt 候选 | 3-5 个 MiniMax prompt。 |
| QA 摘要 | `lyrics_qa_report.json` 的 Pass / Warning / Blocked。 |
| 自动返修记录 | `lyrics_revision_notes.md`。 |

### 8.3 操作按钮

| 按钮 | 显示条件 | 结果 |
|---|---|---|
| 生成歌词 | 状态允许且未生成歌词 | 触发 `lyrics_generating`。 |
| 重新生成歌词 | 歌词已生成 | 新建歌词版本，重新 QA。 |
| 编辑歌词 | 歌词已生成 | 进入轻量文本编辑器。 |
| 选择音乐 prompt | prompt 候选已生成 | 标记 `music_prompt_selected`。 |
| 进入音乐生成 | Lyrics QA 通过或 Warning | 进入 Music Tab。 |

### 8.4 最小编辑器要求

MVP 编辑器只需要：

1. 纯文本编辑；
2. 支持保留 MiniMax 结构标签；
3. 保存为新版本；
4. 保存后重新跑 Lyrics QA；
5. 不需要复杂协同编辑。

---

## 9. Music Tab

### 9.1 目标

让用户完成音乐生成、试听、接受或重生成。

### 9.2 展示内容

| 区块 | 内容 |
|---|---|
| 当前歌词 | 送入 MiniMax 的最终歌词版本。 |
| 当前音乐 prompt | 用户选择或系统默认的 prompt。 |
| 积分预估 | 本次音乐生成预计冻结积分。 |
| 音频播放器 | 播放 `minimax_rap_master.wav` 或可播放转码文件。 |
| 音频信息 | 时长、hash、版本、生成时间。 |
| QA 摘要 | Music Ingest QA、Beat Lock QA 的状态。 |

### 9.3 操作按钮

| 按钮 | 显示条件 | 结果 |
|---|---|---|
| 生成音乐 | `music_prompt_selected` | 触发 `music_generating`。 |
| 重新生成音乐 | `music_ready` 或 `music_needs_review` | 新建音乐版本并重新扣费/冻结。 |
| 接受音乐 | `music_ready` | 状态变为 `music_accepted`。 |
| 拒绝并返回歌词 | `music_ready` | 允许调整歌词或 prompt。 |
| 进入视频生成 | `music_accepted` | 触发 Beat Lock、Section Mapping、Scene Planning。 |

### 9.4 成本确认弹窗

高成本按钮必须显示：

| 字段 | 说明 |
|---|---|
| 预计消耗积分 | 本次任务预估。 |
| 预冻结积分 | 发起后冻结金额。 |
| 失败退款规则 | Provider 失败、系统失败、用户不满意的处理。 |
| 当前项目预算剩余 | 防止超预算。 |
| 确认按钮 | 明确同意扣费规则后执行。 |

---

## 10. Video Tab

### 10.1 目标

展示 HypeFrames 渲染出的 `preview_composite.mp4`，并承载视频 QA 与人工快速审片。

### 10.2 展示内容

| 区块 | 内容 |
|---|---|
| Preview 播放器 | 默认播放 `preview_composite.mp4`。 |
| Review 播放器 | 可切换 `preview_composite_review.mp4`。 |
| 关键帧图 | `keyframes_contact_sheet.jpg`。 |
| Section Timeline | Intro / Verse / Chorus 等时间段。 |
| QA 摘要 | Render QA、Scene QA、HypeFrames File QA。 |
| 渲染产物 | preview、review、overlay、captions、bg_clean。 |

### 10.3 操作按钮

| 按钮 | 显示条件 | 结果 |
|---|---|---|
| 生成 Preview | HypeFrames 文件 QA 通过 | 触发 `preview_rendering`。 |
| 重新渲染 Preview | Preview 已生成或失败 | 新建渲染 StepRun。 |
| 查看 Review 版 | Review 文件存在 | 切换播放器。 |
| 请求人工处理 | QA 为 Warning 或 Needs Review | 标记项目需要人工。 |
| 接受 Preview | Render QA 通过或用户确认 | 进入导出阶段。 |
| 生成分层资产 | Preview 通过且启用方案 B | 触发 `layer_rendering`。 |

### 10.4 最小视频播放器要求

1. 播放、暂停、拖动进度；
2. 显示当前时间码；
3. 支持跳转至 QA 报告中的问题时间点；
4. 支持在关键帧图中点击跳转；
5. 不要求在 MVP 内直接编辑视频。

---

## 11. QA Tab

### 11.1 目标

统一展示所有 Gate 的结果，帮助用户或 Operator 判断是否能自动推进。

### 11.2 Gate 列表

| Gate | UI 展示 |
|---|---|
| Lyrics QA | 格式、事实、可唱性、风险表达。 |
| Music Ingest QA | 音频下载、时长、hash、响度。 |
| Beat Lock QA | BPM、拍点、小节、重拍置信度。 |
| Timing QA | 段落映射、Hook 对齐、信息密度。 |
| Scene QA | 科普性、一致性、可读性、安全区。 |
| HypeFrames File QA | 文件完整性、路径、时间线、输出模式。 |
| Render QA | 文件存在、时长、音频、关键帧、透明层。 |
| Master QA | 总结论：可自动通过、需人工、阻断。 |

### 11.3 状态颜色

| 状态 | UI 语义 |
|---|---|
| `auto_approved` | 绿色，可继续。 |
| `approved_with_warnings` | 黄色，可继续但显示风险。 |
| `auto_fixed` | 蓝色，已自动修复并通过。 |
| `needs_review` | 橙色，需要人工处理。 |
| `blocked` | 红色，阻断后续步骤。 |

---

## 12. Export Tab

### 12.1 目标

提供最终产物下载与剪映交接入口。

### 12.2 下载项

| 文件 | MVP | 说明 |
|---|---:|---|
| `preview_composite.mp4` | 是 | 第一交付物。 |
| `preview_composite_review.mp4` | 是 | 内部审查版。 |
| `minimax_rap_master.wav` | 是 | 主音频。 |
| `lyrics.md` | 是 | 歌词。 |
| `captions.srt` | P1 | 可编辑字幕。 |
| `overlay_full_alpha.mov` | P1 | 分层透明图解。 |
| `captions_alpha.mov` | P1 | 分层透明字幕。 |
| `bg_clean.mp4` | P1 | 干净背景。 |
| `capcut_handoff_pack.zip` | P1 | 剪映交接包。 |
| `project_archive.zip` | P1 | 全项目归档。 |

### 12.3 导出规则

1. `preview_composite.mp4` 生成成功即可下载。
2. 只有 Render QA 通过或用户手动接受后，才标记为 `export_ready`。
3. 分层资产失败时，可降级为 Preview-only 交付。
4. 剪映交接包不得包含 Review 辅助标记。

---

## 13. Logs Tab

### 13.1 内容

| 日志 | 说明 |
|---|---|
| StepRun 日志 | 每次模型调用、分析、渲染、导出的状态。 |
| Provider 日志摘要 | Provider 名称、耗时、成功/失败。 |
| 积分流水摘要 | 预冻结、结算、退款。 |
| Agent 操作日志 | Agent 创建、自动接受、自动渲染等动作。 |
| 错误摘要 | 错误码、可重试性、建议处理。 |

### 13.2 MVP 要求

MVP 不要求展示完整原始请求和返回，但必须展示：

1. 任务 ID；
2. 任务类型；
3. 开始/结束时间；
4. 状态；
5. 失败原因；
6. 关联资产；
7. 关联积分流水。

---

## 14. 最小后台

### 14.1 页面

| 页面 | MVP 必需 | 说明 |
|---|---:|---|
| 用户/Workspace 列表 | 是 | 查看余额和项目数。 |
| 项目检索 | 是 | 按状态、用户、Agent 搜索。 |
| StepRun 列表 | 是 | 重试失败任务、查看错误。 |
| 积分流水 | 是 | 审计扣费、冻结、退款。 |
| Provider 状态 | P1 | 查看 DeepSeek、MiniMax、HypeFrames、存储状态。 |
| Agent 管理 | P1 | API Key、预算、权限、禁用。 |

### 14.2 内部操作

| 操作 | 说明 |
|---|---|
| 重试 StepRun | 仅可重试 retryable 任务。 |
| 标记人工通过 | 对 `needs_review` 项目放行。 |
| 标记阻断 | 明确项目不能自动继续。 |
| 手动退款/补偿 | 写入积分账本，不直接改余额。 |
| 禁用 Agent | 防止自动化失控。 |

---

## 15. 状态驱动 UI 规则

| 工作流状态 | 主要 UI | 可用操作 |
|---|---|---|
| `draft` | Brief | 编辑输入、提交项目。 |
| `material_ready` | Brief / Lyrics | 生成事实卡或歌词。 |
| `lyrics_ready` | Lyrics | 编辑歌词、选择 prompt、进入音乐。 |
| `lyrics_needs_review` | QA | 查看问题、人工确认或重生成。 |
| `music_generating` | Music | 查看进度，不可重复提交。 |
| `music_ready` | Music | 播放、接受、重生成。 |
| `music_accepted` | Music / Video | 进入视频生成。 |
| `beat_needs_review` | QA / Music | 人工选择重分析或重生成音乐。 |
| `scene_ready` | Video | 生成 HypeFrames。 |
| `hypeframes_ready` | Video | 渲染 Preview。 |
| `preview_ready` | Video | 查看 Preview、Render QA。 |
| `render_passed` | Export | 下载 Preview、生成分层资产。 |
| `capcut_pack_ready` | Export | 下载剪映交接包。 |
| `export_ready` | Export | 下载最终资产。 |
| `failed` | Logs / QA | 查看失败、重试或取消。 |

---

## 16. Agent 项目在 UI 中的呈现

Agent 创建或推进的项目应在 Web UI 中清楚标识。

| UI 元素 | 说明 |
|---|---|
| Agent Badge | 显示创建者为 Agent。 |
| Agent Run ID | 可复制，用于排查 API 调用。 |
| 自动接受标记 | 显示是否开启自动接受音乐/Preview。 |
| 预算条 | 显示 Agent 本项目预算使用情况。 |
| 下一步所需动作 | 如 `none`、`human_review_required`、`budget_exceeded`。 |
| 操作审计 | 展示 Agent 在何时触发了什么动作。 |

---

## 17. UI 不做范围

MVP 明确不做：

1. 类剪映式时间线编辑器；
2. 多轨道手动拖拽；
3. 逐字歌词对齐编辑；
4. 复杂模板商城；
5. 多人协同评论；
6. 实时多人审片；
7. 自动发布到平台；
8. 复杂版权授权管理；
9. 面向终端用户的高级音频混音；
10. 全量提示词调参面板。

---

## 18. MVP 验收标准

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| UI-01 | 创建项目 | 用户可创建包含主题、时长、风格、画幅、预算的项目。 |
| UI-02 | 歌词生成 | 用户可看到歌词、结构、prompt 候选和 Lyrics QA。 |
| UI-03 | 音乐生成 | 用户可发起 MiniMax 音乐生成并试听。 |
| UI-04 | 音乐接受 | 用户可接受某一版音乐并锁定进入视频步骤。 |
| UI-05 | Preview 渲染 | 用户可触发并查看 `preview_composite.mp4`。 |
| UI-06 | QA 查看 | 用户可查看所有 Gate 的总览和问题详情。 |
| UI-07 | 导出 | 用户可下载 Preview、音频、歌词和基础清单。 |
| UI-08 | 积分显性 | 高成本任务前展示积分预估和冻结。 |
| UI-09 | 错误处理 | 失败任务显示错误、重试入口和退款状态。 |
| UI-10 | Agent 可观测 | UI 能展示 Agent 创建项目和自动执行状态。 |
