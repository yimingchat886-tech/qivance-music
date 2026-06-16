# Qivance Music x html-video 子 PRD v3：生产工作台闭环

> 日期：2026-06-12
> 状态：Implemented and verified
> 父 PRD：`docs/qivance_music_html_video_integration_prd.md`
> 校准依据：`docs/qivance_music_html_video_integration_prd.v2.md`、`docs/TEST_REPORT.v2.md`、`docs/requirements traceability matrix.md`
> 版本目标：在 V2 已打通媒体 E2E/export 合同的基础上，跑通面向生产用户的基础工作台/API 闭环，并证明 html-video agent runtime 可以稳定产出 AI-authored frame HTML。

---

## 1. V3 定位

V3 不再继续把重点放在“能否从媒体输入产出 `final.mp4`”。V2 已经证明三比例 render、mux、ffprobe、image generation adapter、locked local image gate 和 production-strict evidence gate 的基础能力。

V3 的主线是 **产品化闭环**：

```text
已有项目或 fixture
→ Qivance Workbench 打开项目
→ 展示生产步骤状态和 artifacts
→ 确认 Animation Plan
→ 根据 section_map 推荐图片数量并创建图片时间表
→ 选择小项目级图片风格并调整每张图的画面提示词
→ 审核 / 锁定 / 跳过 / 最小重新生成图像候选
→ 调用 html-video agent runtime 生成 AI-authored frames
→ Qivance Preview 查看结果
→ 输入一条自然语言 revision
→ 重新生成目标 frame 并刷新 Preview
→ render/export final.mp4
```

V3 的硬验收门槛是：production 路径不得依赖 contract fallback frames。html-video agent runtime 超时、非干净退出、未产出 AI-authored frames，均视为 V3 production 验收失败。

---

## 2. 已确认决策

| 编号 | 决策项 | 结论 |
|---|---|---|
| D1 | V3 版本形态 | 生产工作台/API 闭环版 |
| D2 | V3 主线 | 基础 Qivance Workbench + 文件模型 API + Preview revision |
| D3 | V3 硬门槛 | html-video agent runtime 必须产出 AI-authored frames；production 不允许 fallback frame 通过 |
| D4 | 前端承载 | 先用现有 Node 服务跑通基础页面；后续由 OpenDesign 设计并通过 OpenDesign MCP 交接 Next.js 重写 |
| D5 | 数据模型 | 继续使用文件系统项目模型，不引入数据库 |
| D6 | 项目入口 | 只支持打开已有项目 / fixture，不做新建向导、上传或上游生成 |
| D7 | Preview revision | 支持一条自然语言修改意见，面向当前 scene 或整项目；不做元素点选、源码编辑、时间线编辑 |
| D8 | Image review | 支持 accept/lock、reject、skip 和一次最小重新生成；可带简单 prompt override |
| D9 | 多比例验收 | 一个主比例跑完整产品化流程；三比例保留 production-strict media/export 回归 |
| D10 | 上游业务链路 | DeepSeek、MiniMax、Obsidian/RAG、active take 选择不进入 V3 P0 |
| D11 | html-video Studio | 仍只作为内部 debug 工具，不暴露给生产用户 |
| D12 | 图片规划 | 根据 `section_map.json` 推荐图片数量，并生成可人工调整的图片时间表 |
| D13 | 图片提示词 | 每个小项目统一一个图片组；图片组只选择一次风格，每张图片单独调整画面提示词 |
| D14 | Prompt LLM 辅助 | V3 P0 只定义 prompt 结构和人工调整流程；LLM API 辅助生成 / 改写提示词放到下一版本 |
| D15 | 已有 MP4 路径 | 除图片素材路径外，支持“已有本地 MP4 → html-video → video”的独立路径，并保留原 MP4 音频 |

---

## 3. V2 继承能力

V3 默认继承以下 V2 已完成能力，不重复定义为主攻目标：

```text
- 三比例 fixture bundle
- audio analysis / word alignment / section map artifacts
- Codex image_gen parent wrapper 与 ImageGenerationResult 合同
- image_assets lock gate
- ContentGraph / agent_context / frame contract 写入
- frame output validation
- static Preview smoke
- html-video visual render
- Qivance mux locked active MP3 as AAC
- ffprobe visual/final QA
- render_manifest.json
- production-strict evidence flags
```

V3 可以修改这些能力以接入工作台/API，但不得降低 V2 的 production-strict 证据要求。

---

## 4. 输入前提

V3 P0 只处理已有项目或 fixture。每个可打开项目至少需要具备：

```text
active_music_take.mp3
lyrics.md
animation_plan.json
image_generation_plan.json
```

如果项目走“已有 MP4 → html-video → video”路径，可以用本地 source MP4 作为核心输入，替代 `active_music_take.mp3 + image_generation_plan.json` 的图片 / 音乐素材路径：

```text
source_video.mp4
animation_plan.json
```

该路径保留 source MP4 原音频，不使用 active music take 覆盖原音频。

若项目已经从 V2 workflow 运行过，还可以包含：

```text
data/timing/*.json
data/storyboard/section_map.json
data/storyboard/image_assets.json
data/storyboard/image_generation_schedule.json
data/storyboard/image_prompt_group.json
data/source/source_video_import.json
video/html-video/.html-video/projects/<project_id>/
exports/render_manifest.json
exports/final.mp4
```

V3 不负责生成上述上游输入；缺失输入时，Workbench 只能显示阻塞状态和缺失文件诊断，不自动补齐上游内容。

---

## 5. 文件模型与状态

V3 继续使用 `projects/<small_project_id>/...` 文件模型。API 是唯一面向页面的合同层，基础页面不得直接理解项目目录细节。

V3 需要定义或稳定以下文件：

```text
project_status.json           # 工作台读取的聚合状态，可由 API 动态生成或持久化
workflow_checkpoints.json     # 步骤完成 / 失败 / 诊断状态
revision_request.json         # 最近一次自然语言修改意见
agent_runs/*.json             # html-video agent run 与 revision run 记录
image_generation_schedule.json # 基于 section_map 的推荐图片数量、时间范围、生成状态
image_prompt_group.json       # 小项目级图片组风格、每图画面提示词、人工调整记录
image_review_decisions.json   # accept / reject / skip / regenerate 决策记录
source_video_import.json      # 已有 MP4 路径、sha256、ffprobe 摘要、音频策略和导入状态
exports/render_manifest.json  # render/export 主证据
```

允许先用文件聚合器动态生成 `project_status.json` 等价响应。若后续迁移数据库，必须保持 V3 API 语义兼容。

---

## 6. Qivance Workbench 基础页面

V3 P0 的前端目标是跑通生产操作面，不追求最终视觉设计。页面先由现有 Node 服务承载，后续版本在 OpenDesign 完成设计后通过 OpenDesign MCP 交接并用 Next.js 重写。

基础页面必须包含：

```text
- 项目列表：展示可识别的 existing projects / fixtures
- 项目详情：展示输入文件、artifact、当前状态、阻塞原因
- 步骤流：validate input、timing、image review、html-video agent、preview、revision、render、export
- Animation Plan 确认状态：展示已确认 / 未确认 / 阻塞
- Image schedule 面板：展示 section_map 推荐图片数量、时间范围、scene 绑定和可调整状态
- Image prompt 面板：展示小项目级风格选项、已选风格、每张图片的画面提示词和人工调整结果
- Image review 面板：候选图、prompt、尺寸、provenance、accept/reject/skip/regenerate
- Source MP4 面板：当项目使用已有 MP4 路径时，展示本地 MP4、ffprobe 摘要、原音频保留状态和 html-video 状态
- Preview 面板：播放或嵌入当前 Qivance Preview，支持 scene 切换
- Revision 输入：一条自然语言修改意见，选择当前 scene 或整项目
- Agent run 日志摘要：状态、开始结束时间、退出原因、变更文件
- Export 面板：render/export 状态、manifest 摘要、final.mp4 下载入口
```

基础页面不得引入完整设计系统、复杂权限、素材库管理、源码编辑器、时间线编辑器或 html-video Studio UI。

---

## 7. API 范围

V3 P0 API 以已有项目为中心：

```text
GET  /api/projects
GET  /api/projects/:id
GET  /api/projects/:id/status
POST /api/projects/:id/animation-plan/approve
GET  /api/projects/:id/images
GET  /api/projects/:id/images/schedule
POST /api/projects/:id/images/schedule/recommend
POST /api/projects/:id/images/schedule
GET  /api/projects/:id/images/prompt-group
POST /api/projects/:id/images/prompt-group
POST /api/projects/:id/images/:assetId/lock
POST /api/projects/:id/images/:assetId/reject
POST /api/projects/:id/images/skip
POST /api/projects/:id/images/run-generation
POST /api/projects/:id/source-video/import
POST /api/projects/:id/html-video/run-agent
POST /api/projects/:id/html-video/revise
GET  /api/projects/:id/html-video/preview
POST /api/projects/:id/export/render
GET  /api/projects/:id/export/final.mp4
```

V3 不要求实现：

```text
POST /api/big-projects
POST /api/big-projects/:id/small-projects
POST /api/small-projects/:id/sources/import-md
POST /api/small-projects/:id/lyrics/generate
POST /api/small-projects/:id/music/generate
POST /api/small-projects/:id/music/select-active-take
```

这些上游创建和生成能力留给后续版本。

---

## 8. Image Review 最小闭环

V3 P0 的 image review 需要把 V2 的自动 lock gate 产品化为可操作流程。

在进入候选图生成前，Workbench 需要先形成可审核的图片规划：

```text
section_map.json
→ 推荐图片数量与使用时间范围
→ 创建或更新 image_generation_schedule.json
→ 创建或更新 image_prompt_group.json
→ 用户确认图片时间表、风格和每图画面提示词
→ run-generation
```

图片数量推荐规则必须以 `section_map.json` 为主依据，至少考虑 scene 数量、scene duration、视觉变化密度和可复用素材。推荐结果不是强制值，用户可以在生成前调整图片数量、时间范围、scene 绑定和是否跳过某些 scene。

每个小项目只有一个图片组。图片组的提示词由小项目级风格和每张图片独立画面构成：

```text
final image prompt = small-project style prompt + per-image scene prompt + generation constraints
```

要求：

```text
- 小项目图片组只能选择一次 style；项目内所有生成图片复用该 style。
- style 必须来自可展示的选项集，用户可以在生成前切换；切换后需要重新确认该小项目图片组提示词。
- 每张图片都有独立 scene prompt，用于描述该图自己的画面、主体、构图、情绪和禁止项。
- V3 P0 支持人工调整 scene prompt；LLM API 辅助生成 / 改写 scene prompt 放到下一版本。
- 最终送入 image generation adapter 的必须是已确认 prompt 文本。
- `image_prompt_group.json` 必须记录已选 style、每图 scene prompt、人工 override、最终 prompt 和 provenance。
- `image_generation_schedule.json` 必须记录 image_id、scene_id、start/end time、asset_role、target_size、prompt 状态和生成 / 审核状态。
```

每个 image request 必须展示：

```text
- request_id
- scene_id
- asset_role
- prompt
- aspect_ratio / target_size
- candidate path
- width / height
- sha256
- provenance
- 当前 review status
```

支持操作：

```text
- accept/lock：写入或更新 image_assets.json，允许进入 ContentGraph / agent_context
- reject：记录 reject 决策，候选图不得进入 ContentGraph / agent_context
- skip：该 scene 不使用新图，必须在后续 frame contract 中可解释
- regenerate：触发一次最小重新生成，可附简单 prompt override
```

未 locked 的候选图不得进入 ContentGraph、agent_context 或 frame HTML。

regenerate 默认保持小项目级 style 不变，只允许调整该图片的 scene prompt；如果更换 style，需要重新确认整个小项目图片组和图片时间表。

---

## 9. html-video Agent Runtime 硬门槛

V3 production 验收必须证明 html-video agent runtime 真实产出 AI-authored `frames/*.html`。

production 路径禁止：

```text
- html-video agent timeout 后自动写入 contract fallback frames
- 非干净 runtime exit 后继续当作成功
- 使用 fallback frame 通过 render/export 验收
- 把 diagnostic frame 当作 AI-authored frame 记录
```

允许 diagnostic/dev mode 显式使用 fallback，但必须满足：

```text
- 需要显式 flag
- manifest 和 agent run log 清楚标记 diagnostic/fallback
- 不计入 V3 production 成功证据
```

agent run log 至少记录：

```text
agent_run_id
mode: production | diagnostic
input artifacts
started_at / finished_at
exit_code
timed_out
changed_files
ai_authored_frame_paths
validation result
diagnostics
```

---

## 10. Preview Revision

V3 P0 支持一条自然语言 revision：

```text
用户在 Qivance Preview 输入修改意见
→ 选择作用范围：当前 scene 或整项目
→ 写入 revision_request.json
→ 调用 html-video agent runtime
→ 验证 changed_files 与 frame contract
→ 刷新 Preview
→ 记录 revision agent run
```

V3 不做：

```text
- 元素点选编辑
- HTML/CSS/JS 源码编辑
- 时间线编辑
- 多轮复杂编辑器
- 自动视觉差异理解
```

revision 成功必须继续满足 locked local image、strict duration、forbidden path gate、frame output validation。

---

## 11. Render / Export 回归

V3 仍需保留 V2 的 production-strict media/export 回归：

```text
- 一个主比例完整跑通工作台/API/revision/render/export
- 9:16、16:9、1:1 三比例保留 production-strict media/export E2E 回归
- cached/seeded imagegen、fallback frames、missing review decisions、CPU-only diagnostic 等不得计入 production 成功
```

主比例默认建议为 `9:16`，也可以由 project 或 fixture metadata 标记 `primary_ratio`。

---

## 11.1 已有 MP4 → html-video → video 路径

V3 在图片素材路径之外，增加一条已有本地 MP4 的独立路径：

```text
已有本地 source_video.mp4
→ Workbench/API 导入并记录 source_video_import.json
→ 作为 locked local video asset 写入 html-video 上下文
→ html-video agent runtime 生成或更新承载该 MP4 的 AI-authored frame HTML
→ Qivance Preview 查看
→ 可提交一条自然语言 revision
→ render/export final.mp4
```

该路径的音频策略与图片 / 音乐素材路径不同：source MP4 的原音频是 master audio，必须保留；不得默认用 `active_music_take.mp3` 覆盖。

要求：

```text
- 只接受本地可读 MP4，不接受远程 URL 作为 production 输入。
- 导入时记录 path、sha256、ffprobe 摘要、duration、width、height、audio stream、provenance。
- source MP4 必须作为 locked local video asset 进入 html-video 上下文。
- frame HTML 不得引用未登记的外链视频、临时路径或未 locked 本地视频。
- 该路径可以跳过图片生成和 image review，但不能跳过 agent run log、preview、render_manifest 和 production-strict evidence。
- render/export 必须记录原音频保留证据，包括 final.mp4 的音频流来源与 ffprobe 摘要。
```

V3 P0 不要求自动理解并拆分 source MP4 的完整语义；只要求它能作为受控本地视频素材进入 HTML frame 和 render/export 链路。

---

## 12. 验收标准

V3 完成需要同时满足：

```text
- 可以从基础 Workbench 打开已有项目或 fixture
- 页面能展示项目状态、步骤状态、输入文件、主要 artifacts 和阻塞原因
- 可以确认 Animation Plan
- 可以根据 section_map 推荐图片数量，并生成可人工调整的 image_generation_schedule.json
- 可以为小项目图片组选择一次风格，并为每张图片人工调整独立画面提示词
- 可以完成 image review 最小闭环：accept/reject/skip/regenerate
- 未 locked 图片无法进入 ContentGraph / agent_context / frame HTML
- 可以导入已有本地 MP4，并走通 source MP4 → AI-authored frame HTML → preview/render/export
- 已有 MP4 路径保留 source MP4 原音频，且 render_manifest / ffprobe 记录音频来源证据
- production html-video agent runtime 产出 AI-authored frames
- production 路径不依赖 fallback frames
- 可以在 Qivance Preview 查看当前结果
- 可以提交一条自然语言 revision 并刷新 Preview
- 可以从页面或 API 触发 render/export 并下载 final.mp4
- 主比例完整产品化流程通过
- 三比例 production-strict media/export 回归通过
- docs/TEST_REPORT.v3.md 记录证据、命令、manifest、agent run 和剩余 gap
```

---

## 13. 非目标

V3 P0 明确不做：

```text
- 新建项目向导
- 文件上传入口
- 远程 MP4 URL 导入
- 自动解析已有 MP4 的完整语义并重建 storyboard
- Obsidian MD 导入
- DeepSeek 歌词生成
- MiniMax 音乐生成
- LLM API 辅助生成 / 改写图片提示词
- active take 选择 UI
- 完整 RAG / source capsule / recycle pipeline
- 数据库 / Prisma / SQLite / Postgres
- Next.js / React / Vite 重写
- OpenDesign 最终视觉实现
- 完整设计系统
- 复杂权限
- html-video Studio 暴露给生产用户
- 元素点选、源码编辑、时间线编辑
- 模板编辑器
- resources.zip
```

---

## 14. 文档交付要求

V3 实施前后应按顺序补齐：

1. 从本 PRD 写 `docs/SPEC.v3.md`。
2. 从 SPEC 写 `docs/PLAN.v3.md`。
3. 实施后写 `docs/TEST_REPORT.v3.md`。
4. 更新 `docs/requirements traceability matrix.md` 的 V3 状态、证据和下一版决策。
5. 若后续进入 OpenDesign/Next.js 重写，新增设计交接 PRD 或 Delta SPEC，不覆盖本 V3 PRD 的 API/流程合同。
