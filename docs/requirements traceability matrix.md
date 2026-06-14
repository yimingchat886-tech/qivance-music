# Requirements Traceability Matrix

Date: 2026-06-14
Branch: `codex/v3-production-workbench`

Sources:
- V2 PRD: `docs/qivance_music_html_video_integration_prd.v2.md`
- V2 SPEC / PLAN: `docs/SPEC.v2.md`, `docs/PLAN.v2.md`
- V2 report: `docs/TEST_REPORT.v2.md`
- V3 PRD: `docs/qivance_music_html_video_integration_prd.v3.md`
- V3 SPEC / PLAN: `docs/SPEC.v3.md`, `docs/PLAN.v3.md`
- V3 report: `docs/TEST_REPORT.v3.md`

Latest evidence commits:
- `e67e223` - source-video Workbench contracts
- `281fc98` - V3 completion evidence
- `fa823f4` - V3 source-video E2E path
- `1d5953f` - V3 production verification
- `4918024` - V3 test evidence

Status legend:
- `已实现并验收`: implemented and backed by tests, local E2E, or artifact evidence.
- `已实现`: implemented with direct or adjacent test coverage.
- `部分实现`: useful implementation exists, but it is not the full product requirement.
- `未实现`: no production implementation in the current repo.
- `暂缓`: explicitly outside V2/V3 scope.

| 需求域 | 关联需求 | V2 当前实现与验收 | V3 当前实现与验收 | 仍未实现 / 后续范围 | 主要证据 |
|---|---|---|---|---|---|
| 版本目标 | R5, R16, R47-R53, V3-R9 | 已实现并验收：V2 证明三比例 media/export 链路可以产出 `final.mp4`、manifest、ffprobe QA。 | 已实现并验收：V3 在 V2 media/export 之上完成 Workbench/API/revision/render/export 产品闭环，并新增 source-video 产品路径。 | 无 V3 P0 open gap；后续是更完整产品形态而非 V3 P0 阻塞项。 | `docs/TEST_REPORT.v2.md`; `docs/TEST_REPORT.v3.md`; `projects/v3_product_primary_9x16_20260612132805/exports/final.mp4`; `projects/v3_source_video_9x16_20260612144302/exports/final.mp4` |
| 项目入口与范围 | R1-R4, R61-R66, V3-R1 | 部分实现：V2 使用已有 fixture / project files；未实现完整登录、大项目、小项目创建、资料导入、lyrics/music/timing 上游 API。 | 已实现并验收：V3 明确只打开已有 projects / fixtures，缺失输入显示 blocked diagnostics，不实现新建、上传、上游生成。 | 登录、复杂权限、新建项目向导、上传入口、大/小项目 CRUD、资料/歌词/音乐/timing 生成 API 仍未实现。 | `src/lib/workbench/project-status.ts`; `src/server.ts`; `tests/workbench-project-status.test.ts`; `tests/workbench-api.test.ts` |
| 文件模型 / 数据模型 | R9, R25-R29, R69-R73, V3-R2 | 已实现：`small_project_id === html-video project id`，workspace 写入 `project.json`、`content-graph.json`、`qivance-frame-contracts.json`、`codex/agent_context.json`。数据库表未实现。 | 已实现并验收：V3 保持 file-system project model 为权威状态，API 只暴露文件视图；DB/Prisma/SQLite/Postgres 明确暂缓。 | `big_projects`、`small_projects`、`artifacts`、`agent_runs`、`render_runs` 等数据库表未实现，后续若引入 DB 必须保持 V3 API 语义。 | `src/lib/project-core/paths.ts`; `src/lib/workbench/project-status.ts`; `tests/html-video-workspace.test.ts`; `tests/workbench-api.test.ts` |
| Workbench UI | R38-R40, R74-R77, V3-R10 | 部分实现：V2 有 preview/static frame serving 和部分 html-video API；没有生产用户 Workbench。 | 已实现并验收：V3 由当前 Node 服务提供 `/projects`、`/projects/:id`，展示状态、输入、steps、approval、image review、source MP4、preview、revision、export。 | 最终 OpenDesign/Next.js 重写、完整设计系统、复杂权限、节点化高保真 UI 仍暂缓。 | `src/lib/workbench/workbench-html.ts`; `src/server.ts`; `tests/workbench-html.test.ts`; `tests/server-urls.test.ts` |
| Animation Plan | R13-R15, R66, V3-R3 | 部分实现：V2 能验证并映射 Animation Plan 到 ContentGraph；用户确认/approve API 未作为产品门槛完成。 | 已实现并验收：V3 增加 `POST /animation-plan/approve`，`workflow_checkpoints.json` 记录 approval，未批准会阻塞 downstream production action。 | 自动生成/patch Animation Plan 的上游 API 仍未实现；V3 只处理已有计划。 | `src/server.ts`; `tests/workbench-api.test.ts`; `tests/workbench-project-status.test.ts` |
| Timing / section map | R17-R19, R86, V3-R3 | 部分实现：V2 fixture 提供 `section_map.json`、`beat_grid.json`、`lyric_word_timing.json` 并被 workflow 消费；Python 音频分析 API 和人工 section_map 编辑未实现。 | 已实现并验收：V3 以已有 `section_map.json` 推荐 image schedule，支持 image count、time range、scene binding、skip state 的文件合同。 | 音频分析生成 timing、word-level pop 深化、人工 section map 编辑仍未实现。 | `src/lib/image-generation/image-schedule.ts`; `tests/image-generation-schedule.test.ts`; `projects/v3_product_primary_9x16_20260612132805/data/storyboard/image_generation_schedule.json` |
| Image generation adapter | R89-R91, V3-R5 | 已实现并验收：V2 接入 Codex image_gen parent wrapper / external command contract，记录 candidate path、sha、尺寸、provenance；三比例 E2E 可跑通。 | 已实现并验收：V3 adapter 请求只使用 confirmed prompt text；primary product flow 和 three-ratio regression 记录 production evidence。 | LLM API 辅助 prompt 生成/改写未实现；远程模型/插件刷新超时仍需通过显式 timeout/diagnostic 处理。 | `src/lib/image-generation/codex-image-gen-adapter.ts`; `scripts/codex-image-gen-parent-wrapper.ts`; `tests/codex-image-gen-external-command.test.ts`; `docs/TEST_REPORT.v3.md` |
| Image schedule / prompt group / review | R90-R92, V3-R3-R6 | 部分实现：V2 有自动 image_assets lock gate，但人工 review/API UX 不完整。 | 已实现并验收：V3 有 `image_generation_schedule.json`、`image_prompt_group.json`、`image_review_decisions.json`，支持 lock/reject/skip/regenerate，锁定候选写入 `image_assets.json`。 | RAG recycle 仍未实现；更复杂素材库管理和 LLM prompt assistant 暂缓。 | `src/lib/image-generation/image-schedule.ts`; `src/lib/image-generation/image-prompt-group.ts`; `src/lib/image-generation/image-review-decisions.ts`; `tests/image-review-decisions.test.ts`; `tests/workbench-api.test.ts` |
| Locked assets / frame reference gate | R35-R36, R92-R94, V3-R8 | 部分实现到已实现：V2 禁止未锁定本地图像和外链图进入 frame HTML；AI-authored frame 稳定性在 V2 仍不足。 | 已实现并验收：V3 production agent 必须产出 AI-authored frames，frame validator 拒绝 remote image/video、unlocked image、unregistered local video，source-video E2E 校验 frame 引用 locked MP4。 | 更丰富的资产权限/素材库规则未实现。 | `src/lib/video-html/frame-output-validator.ts`; `src/lib/video-html/frame-output-contract-validator.ts`; `tests/frame-output-contract-validator.test.ts`; `scripts/e2e-source-video-v3.ts` |
| html-video agent runtime | R31-R37, V3-R9 | 部分实现：V2 vendor runtime 已接入；V2 media E2E 曾允许 contract fallback 作为诊断，不能证明 AI frame authoring 稳定。 | 已实现并验收：V3 production run/revision 均要求 clean exit、AI-authored frame paths、valid frames、no fallback、no forbidden path changes；runtime diagnostics 写入项目 `codex/`。 | 多轮复杂编辑器、元素点选、源码编辑、时间线编辑未实现。 | `src/lib/video-html/agent-run-log.ts`; `src/lib/video-html/codex-frame-agent-prompt.ts`; `src/server.ts`; `tests/html-video-agent-production-gate.test.ts`; `projects/v3_product_primary_9x16_20260612132805/video/html-video/.html-video/projects/v3_product_primary_9x16_20260612132805/agent_runs/` |
| Preview / revision | R37-R40, R77, V3-R9 | 部分实现：V2 有 preview model 和 static frame serving；生产用户 revision flow 未完整验收。 | 已实现并验收：V3 支持一条自然语言 revision，scope 为 scene 或 project，写入 `revision_request.json`，成功后刷新 preview 并记录 revision agent run。 | 元素 picker、自动视觉 diff、多轮编辑器、源码编辑器、timeline editor 暂缓。 | `src/lib/video-html/revision-request.ts`; `src/lib/video-html/preview-model.ts`; `tests/workbench-api.test.ts`; `docs/TEST_REPORT.v3.md` |
| Render / export / media QA | R47-R53, R67-R68, R88, V3-R9 | 已实现并验收：V2 render visual-only MP4，Qivance mux locked active MP3/AAC，ffprobe 校验视频/音频/duration/fps/resolution，三比例 final MP4 通过。 | 已实现并验收：V3 `POST /export/render` 写 `render_manifest.json`，primary product E2E、source-video E2E、三比例 regression 均通过；manifest 阻止 fallback/diagnostic 当作 production success。 | `resources.zip`、完整 render history DB、任务重试队列未实现。 | `src/lib/export/render-manifest-v3.ts`; `src/lib/export/mux-locked-audio.ts`; `tests/render-manifest-v3.test.ts`; `projects/v3_media_regression_20260612135609/*/exports/render_manifest.json` |
| Source MP4 独立路径 | V3-R7, V3-R8 | V2 未覆盖：V2 主路径是 active music take + generated/locked images。 | 已实现并验收：V3 支持本地 `source_video.mp4` 导入、ffprobe/sha evidence、locked local video context、AI-authored frame 引用、preview/revision/render/export，并保留原 MP4 音频。 | 远程 MP4 URL 导入明确不支持；自动解析已有 MP4 语义并重建 storyboard 暂缓。 | `src/lib/video-html/source-video-import.ts`; `scripts/e2e-source-video-v3.ts`; `.trellis/spec/qivance-workbench/backend/source-video-contracts.md`; `projects/v3_source_video_9x16_20260612144302/exports/render_manifest.json` |
| 三比例回归 | R16, R47-R53, V3-R9 | 已实现并验收：V2 portrait 9:16、landscape 16:9、square 1:1 media/export E2E 通过。 | 已实现并验收：V3 保留 production-strict three-ratio regression，不允许 cached/seeded imagegen、fallback frames、missing review decisions、diagnostic-only mode 计入成功。 | 无 V3 P0 gap；CI 仍以 mocked deps 为主，live external deps 仍是本地 E2E。 | `scripts/e2e-media-v3-regression.ts`; `docs/TEST_REPORT.v3.md`; `projects/v3_media_regression_20260612135609/` |
| Legacy removal / vendor integration | R6-R12, R44-R46 | 已实现：根项目使用 pnpm workspace 解析 vendor html-video packages；旧 `hypeframes/**` 和 legacy backend 不参与 runtime；strict duration 不改 core public schema。 | 已实现：V3 继续使用 vendor html-video + Qivance wrappers，额外更新 runtime Codex `workspace-write` sandbox。 | 无 V3 P0 gap；后续 vendor 升级仍需单独验证。 | `vendor/html-video`; `package.json`; `src/lib/video-html/qivance-hyperframes-strict-adapter.ts`; `vendor/html-video` submodule commit `3d2ce46` |
| Diagnostics / fallback policy | R31-R32, R94, V3-R9 | 部分实现：V2 允许 diagnostic fallback 并在 manifest 中显式记录；V2 不把它当 AI-authoring 稳定性证据。 | 已实现并验收：V3 production gate 遇到 timeout、non-zero exit、missing AI frames、fallback、forbidden changes、invalid frames 直接失败；diagnostic fallback 需要显式 flag 且不计入 production success。 | 更完整重试/队列/恢复机制未实现。 | `src/lib/media-e2e/workflow.ts`; `tests/media-e2e-workflow.test.ts`; `tests/html-video-agent-production-gate.test.ts` |
| Upstream content chain | R54-R60, R63-R65, R80-R87 | 未实现或暂缓：Obsidian import、source capsule、RAG recycle、DeepSeek lyrics、MiniMax music、active take selection UI、audio analysis API、SaaS/Tailscale/Cloudflare Access 不在当前 V2 E2E 完成范围。 | 暂缓：V3 明确不做上游创建/生成链路，只消费已有 project/fixture 和 source MP4。 | 这些仍是后续版本主要未实现范围。 | `docs/qivance_music_html_video_integration_prd.v3.md`; `docs/PLAN.v3.md`; `docs/TEST_REPORT.v3.md` |
| Templates / advanced editor | R41-R43, R76-R78 | 未实现或部分内部可用：html-video Studio 作为内部 debug，模板选择/模板管理/资源包未产品化。 | 暂缓：V3 不暴露 html-video Studio 生产 UI，不做模板编辑器、元素点选、源码编辑、timeline editor、`resources.zip`。 | Qivance rap teaching template productization、template selection rules、resources packaging 仍未实现。 | `docs/PLAN.v3.md`; `docs/SPEC.v3.md` |
| 安全 / 权限 / SaaS | R1, R79-R83 | 未实现或暂缓：登录、权限、Tailscale、Cloudflare Access、SaaS、复杂项目权限未实现。 | 暂缓：V3 只做本地基础工作台和 API，不实现复杂权限或 SaaS。 | 内部访问控制、用户体系、权限模型、SaaS 化仍未实现。 | V3 Non-Goals in `docs/qivance_music_html_video_integration_prd.v3.md` |
| 证据与验收 | all V2/V3 P0 evidence | 已实现并验收：V2 report 记录 media/export 三比例结果与 caveat。 | 已实现并验收：V3 report 记录 focused tests、typecheck、primary product E2E、three-ratio regression、source-video E2E、artifact paths 和 no open V3 P0 gap。 | 后续版本应新增对应 TEST_REPORT，而不是覆盖 V2/V3 evidence。 | `docs/TEST_REPORT.v2.md`; `docs/TEST_REPORT.v3.md`; `docs/requirements traceability matrix.md` |

## Acceptance Summary

- V2 验收结论：media/export 合同已通过三比例验收；V2 不再作为 AI-authored frame 稳定性的最终证据，因为 fallback/timeout 是诊断路径。
- V3 验收结论：V3 P0 生产工作台/API 闭环已通过；primary product flow、source-video product flow、three-ratio production-strict regression 均有本地 artifact 证据。
- 未实现结论：剩余未实现项集中在上游内容生产、项目/用户/权限/SaaS、最终视觉设计、模板/高级编辑器、RAG recycle、数据库化和资源打包，均不是当前 V3 P0 阻塞项。
