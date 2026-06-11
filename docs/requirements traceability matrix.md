# Requirements Traceability Matrix

Date: 2026-06-11
Branch: `codex/brock-imagegen-smoke-wrapper`
PRD source: `docs/qivance_music_html_video_integration_prd.v2.md`
SPEC source: `docs/SPEC.v2.md`
PLAN source: `docs/PLAN.v2.md`

Status legend:
- `已实现`: current code implements the requirement and has direct or adjacent test coverage.
- `部分实现`: current code implements the boundary or skeleton, but not the full PRD behavior.
- `未实现`: no current V1 implementation.
- `暂缓`: explicitly out of the current implementation scope.

| PRD ID | 需求 | 优先级 | 当前状态 | 测试结果 | V2 决策 | SPEC 位置 | PLAN 任务 |
|---|---|---|---|---|---|---|---|
| R1 | 用户可以登录内部工作台，P0 阶段不区分复杂权限 | P0 | 未实现 | 未测 | V2 实现 | 暂不进入 | 无 |
| R2 | 用户可以创建、查看、更新大项目 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R3 | 用户可以创建、查看、更新、提交小项目 | P0 | 部分实现 | 部分通过 | V2 补齐 API 和状态 | Project Layout | P2 |
| R4 | 支持 AI 概念、英语单词、AI 工具场景三类内容 | P0 | 部分实现 | 通过 | 保持并扩展内容层 | Video Contract | P2 |
| R5 | 小项目最终交付 `exports/final.mp4` | P0 | 部分实现 | 部分通过 | V2 做真实 E2E | Export | P7 |
| R6 | html-video 以 vendor/submodule/fork 深度接入 | P0 | 已实现 | 通过 | 保持 | Vendor Integration | P1 |
| R7 | 后端直接 import `@html-video/core`、`@html-video/content-graph`、`@html-video/adapter-hyperframes` | P0 | 已实现 | 通过 | 保持 | Vendor Integration | P1 |
| R8 | 根项目成为 pnpm workspace 并解析 vendor packages | P0 | 已实现 | 通过 | 保持 | Vendor Integration | P1 |
| R9 | `small_project_id === html-video project id` | P0 | 已实现 | 通过 | 保持 | Project Layout | P2、P4 |
| R10 | 旧 `hypeframes/**` 主视频工程链路不再参与 runtime | P0 | 已实现 | 通过 | 保持 | Legacy Removal | P0 |
| R11 | 旧 Qivance 自建 Codex runner 不再参与 runtime | P0 | 已实现 | 通过 | 保持 | Legacy Removal | P0 |
| R12 | 不提供 legacy fallback 或 `VIDEO_BACKEND=legacy` | P0 | 已实现 | 通过 | 保持 | Legacy Removal | P0 |
| R13 | Animation Plan 按视觉场景拆分 frame/scene 边界 | P0 | 已实现 | 通过 | 保持 | Video Contract | P2、P3 |
| R14 | Animation Plan 需要用户确认后进入视频制作 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R15 | Animation Plan 验证稳定 scene id、非空 scenes、连续 order、duration 合法 | P0 | 已实现 | 通过 | 保持 | Video Contract | P2 |
| R16 | 支持 `9:16`、`16:9`、`1:1` 输出比例 | P0 | 部分实现 | 部分通过 | V2 做渲染矩阵验证 | Video Contract、Export | P2、P7 |
| R17 | word-level timing 用于字幕逐词高亮和关键词 pop | P0 | 部分实现 | 未测 | V2 补齐 timing parser | Frame Contracts | P2 |
| R18 | `section_map.json`、`beat_grid.json`、`lyric_word_timing.json` 作为 timing 输入 | P0 | 部分实现 | 部分通过 | V2 深化 validation | Video Contract、Frame Contracts | P2 |
| R19 | Python 音频分析生成 section map、beat grid、word timing | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R20 | Qivance 生成 html-video ContentGraph | P0 | 已实现 | 通过 | 保持 | ContentGraph Mapping | P3 |
| R21 | ContentGraph node id 等于 scene id | P0 | 已实现 | 通过 | 保持 | ContentGraph Mapping | P3 |
| R22 | ContentGraph 使用 ordered sequence edges | P0 | 已实现 | 通过 | 保持 | ContentGraph Mapping | P3 |
| R23 | 第一阶段所有内容类别映射为 `intent = explainer` | P0 | 已实现 | 通过 | 保持，V2 可细分 intent | ContentGraph Mapping | P3 |
| R24 | 映射时运行 html-video validate、topoSort、totalDurationSec | P0 | 已实现 | 通过 | 保持 | ContentGraph Mapping | P3 |
| R25 | 写入 html-video workspace 到 `projects/<id>/video/html-video/.html-video/projects/<id>/` | P0 | 已实现 | 通过 | 保持 | Project Layout | P4 |
| R26 | 写入 `project.json` | P0 | 已实现 | 通过 | 保持 | Project Layout | P4 |
| R27 | 写入 `content-graph.json` | P0 | 已实现 | 通过 | 保持 | Project Layout | P4 |
| R28 | 写入 `qivance-frame-contracts.json` | P0 | 已实现 | 通过 | 保持 | Frame Contracts | P4 |
| R29 | 写入 `codex/agent_context.json` | P0 | 已实现 | 通过 | 保持 | Codex Frame Agent | P4、P5 |
| R30 | agent_context 包含 lyrics、timing、beat、word、plan、style 等权威上下文 | P0 | 部分实现 | 部分通过 | V2 补齐 lyrics/style/timing 内容 | Codex Frame Agent | P5 |
| R31 | 使用 html-video agent runtime 或其项目内 agent 机制生成 `frames/*.html` | P0 | 部分实现 | 部分通过 | V2 对齐 vendor runtime | Codex Frame Agent | P5 |
| R32 | 第一阶段直接调用真实 Codex，不提供 deterministic-only demo fallback | P0 | 已实现 | 部分通过 | 保持，补 E2E | Codex Frame Agent、Demo Boundary | P5、P9 |
| R33 | Codex prompt 从 agent context、ContentGraph、frame contracts 构建 | P0 | 已实现 | 通过 | 保持 | Codex Frame Agent | P5 |
| R34 | Codex JSONL 输出持久化到 `codex/result.jsonl` | P0 | 已实现 | 通过 | 保持 | Codex Frame Agent | P5 |
| R35 | Codex 仅允许修改 `frames/**/*.html`、`codex/**`、`qa/**` | P0 | 已实现 | 通过 | 保持 | Codex Frame Agent | P5 |
| R36 | Codex 修改 forbidden path 时以 `codex-forbidden-file-change` 失败 | P0 | 已实现 | 通过 | 保持 | Codex Frame Agent | P5 |
| R37 | 用户可以通过修改意见迭代 frame HTML | P0 | 未实现 | 未测 | V2 实现 turns/revisions | Codex Frame Agent、Preview And Canvas | P5、P8 |
| R38 | Qivance Preview 作为生产用户唯一预览入口 | P0 | 部分实现 | 通过 | V2 做 UI canvas | Preview And Canvas | P8 |
| R39 | Preview 从 html-video `project.json`、ContentGraph、frame contracts、frames 读取 | P0 | 部分实现 | 通过 | V2 补齐 ContentGraph 使用 | Preview And Canvas | P8 |
| R40 | 预览 frame 静态服务只能服务请求项目下净化后的 basename | P0 | 已实现 | 通过 | 保持 | Preview And Canvas | P8 |
| R41 | html-video Studio 只作为内部 debug 工具 | P1 | 未实现 | 未测 | V2 评估管理入口 | Non-Goals、Preview And Canvas | 无 |
| R42 | 自带模板和 Qivance rap 教学模板并存 | P1 | 未实现 | 未测 | V2 实现模板包 | Non-Goals | 无 |
| R43 | 模板选择规则按内容类别、输出比例、节奏强度选择 | P1 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R44 | strict duration 策略：禁止自动延长 frame duration | P0 | 已实现 | 通过 | 保持并增强检测 | Strict Duration Render | P6 |
| R45 | strict duration 超时抛 `duration-policy-violation` | P0 | 已实现 | 通过 | 保持 | Strict Duration Render | P6 |
| R46 | strict render 不修改 `@html-video/core` 公共 schema | P0 | 已实现 | 通过 | 保持 | Strict Duration Render | P6 |
| R47 | html-video render visual-only MP4 | P0 | 部分实现 | 未测 | V2 做真实 render E2E | Strict Duration Render、Export | P7 |
| R48 | Qivance 自己 mux locked `active_music_take.wav` | P0 | 部分实现 | 部分通过 | V2 做真实 mux E2E | Export | P7 |
| R49 | final audio 必须来自 active music take | P0 | 部分实现 | 部分通过 | V2 加强 manifest/probe 证明 | Export | P7 |
| R50 | ffprobe QA 校验视频流、音频流、duration drift、fps、resolution | P0 | 部分实现 | 部分通过 | V2 补齐 visual/final 双 probe | Export | P7 |
| R51 | `duration_drift_ms <= 150` | P0 | 部分实现 | 未测 | V2 明确阈值并测试 | Export | P7 |
| R52 | `render_manifest.json` 完整记录 backend、engine、strict policy、paths、stream checks、duration drift、fps、resolution | P0 | 部分实现 | 通过 | V2 扩展 schema | Export | P7 |
| R53 | `final.mp4` 有且只有一个主音频流 | P0 | 未实现 | 未测 | V2 加 ffprobe stream count | Export | P7 |
| R54 | Obsidian MD 导入 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R55 | LLM 生成 `source_capsule.json` 清洗结果 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R56 | RAG 资产回收池 | P1 | 未实现 | 未测 | V2 或后续实现 | Non-Goals | 无 |
| R57 | 成功动画模式检索复用 | P1 | 未实现 | 未测 | V2 或后续实现 | Non-Goals | 无 |
| R58 | DeepSeek Rap 歌词生成 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R59 | MiniMax Music 生成 take | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R60 | active_music_take 人工选择 | P0 | 未实现 | 未测 | V2 实现选择 UI/状态 | Non-Goals | 无 |
| R61 | 大项目 API：create/list/get/patch | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R62 | 小项目 API：create/get/patch/submit | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R63 | 资料与 RAG API：import/generate/clean/retrieve/recycle | P0/P1 | 未实现 | 未测 | V2 分阶段实现 | Non-Goals | 无 |
| R64 | 歌词与音乐 API：generate/select/generate music/select active take | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R65 | 音频分析 API：analyze/get timing | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R66 | Animation Plan API：generate/patch/approve | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R67 | html-video API：create project/write graph/run agent/revise/preview/render visual | P0 | 部分实现 | 通过 | V2 对齐 PRD URL 和完整任务 API | Preview And Canvas | P4、P5、P7、P8 |
| R68 | Export API：mux/qa/package/download final.mp4 | P0/P1 | 部分实现 | 部分通过 | V2 实现完整 export API | Export | P7 |
| R69 | 数据库表 `big_projects` | P0 | 未实现 | 未测 | V2 实现或改为文件模型 | Non-Goals | 无 |
| R70 | 数据库表 `small_projects` | P0 | 未实现 | 未测 | V2 实现或改为文件模型 | Project Layout | P2 |
| R71 | 数据库表 `artifacts` | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R72 | 数据库表 `agent_runs` | P0 | 未实现 | 未测 | V2 实现 turns/runs | Codex Frame Agent | P5 |
| R73 | 数据库表 `render_runs` | P0 | 未实现 | 未测 | V2 实现 render history | Export | P7 |
| R74 | UI 主界面含大项目/小项目列表、步骤流、artifact/preview、任务日志 | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R75 | 步骤流覆盖资料、歌词、音乐、timing、Animation Plan、html-video、render、export | P0 | 未实现 | 未测 | V2 实现 | Non-Goals | 无 |
| R76 | 节点化展示资料/RAG/歌词/音乐/Animation Plan/Preview 位置 | P1 | 未实现 | 未测 | V2 或后续实现 | Non-Goals | 无 |
| R77 | Preview 修改体验：用户提交修改意见，刷新 Qivance Preview，记录 agent run | P0 | 未实现 | 未测 | V2 实现 | Preview And Canvas、Codex Frame Agent | P5、P8 |
| R78 | `resources.zip` 可选资源包 | P1 | 未实现 | 未测 | V2 或后续实现 | Non-Goals | 无 |
| R79 | 任务失败重试 | P1 | 未实现 | 未测 | V2 实现 | Risks | 无 |
| R80 | Tailscale 内部访问 | P1 | 未实现 | 未测 | 继续推迟 | Non-Goals | 无 |
| R81 | SaaS 化 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R82 | Cloudflare Access | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R83 | 复杂项目权限 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R84 | PDF/Word/网页/视频字幕导入 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R85 | 人工歌词校验 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R86 | 人工 section_map 编辑 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R87 | 深度教学体系 | P2 | 暂缓 | 不适用 | 继续推迟 | Non-Goals | 无 |
| R88 | 禁止 html-video 生成或管理最终 rap 主音频 | P0 | 已实现 | 部分通过 | 保持并补 E2E | Export | P7 |
| R89 | Animation Plan 确认后、html-video 前支持可选生图步骤 | P0 | 部分实现 | 部分通过 | V2 已有 workflow image gate；full E2E 待跑通 | SPEC.v2 4.3、9；workflow generate_background_images | P6、P11 |
| R90 | Animation Plan scene 可声明 `image_generation.enabled`、素材角色、prompt 和参考图 | P0 | 部分实现 | 通过 | fixture/schema 与 request 转换已覆盖；产品级编辑入口待补 | SPEC.v2 4.2、4.3 | P2、P6 |
| R91 | Codex CLI image_gen adapter 生成候选图并记录 request/response/provenance | P0 | 部分实现 | 通过 | parent wrapper 已可真实调用 Codex image_gen；full E2E manifest 待补 | SPEC.v2 9；codex-image-gen-parent-wrapper | P6 |
| R92 | 候选图必须审核并锁定为 `image_assets.json` 后才能进入视频制作 | P0 | 部分实现 | 部分通过 | workflow 自动锁定首选候选；人工审核/API 待补 | SPEC.v2 10；image-assets lock gate | P6 |
| R93 | ContentGraph 与 `agent_context.json` 只引用锁定后的本地图像素材 | P0 | 部分实现 | 部分通过 | locked assets 已映射到 animation plan/frame contracts；需 full runtime 证明 | SPEC.v2 11；workflow write_html_video_workspace | P7、P8 |
| R94 | frame HTML agent 不在 html-video 制作阶段临时生图或引用未锁定外链图 | P0 | 部分实现 | 部分通过 | frame validator/path gate 已覆盖；需 full runtime 输出证明 | SPEC.v2 11、12；frame-output validator | P8 |
| R95 | 生成图像素材、prompt 与 provenance 可进入 RAG 资产回收 | P1 | 未实现 | 未测 | V2 后续实现 | 待更新 | 无 |

## V2 Priority Notes

- Highest V2 backend gap: real E2E for Codex, render, mux, ffprobe, and final MP4.
- Highest V2 product gap: project creation, upstream source/lyrics/music/timing pipeline, and Animation Plan approval.
- Highest V2 data gap: timing bundle validation and `wordTimingRange` population.
- Highest V2 UI gap: production canvas/editor and preview revision loop.
- Remaining V2 image gap: run full three-ratio media E2E with the parent wrapper, prove locked local image assets through html-video runtime/render manifests, and add real review/API UX.


## V2 Media E2E Recalibration - 2026-06-11

Branch: `codex/brock-imagegen-smoke-wrapper`
TEST_REPORT source: `docs/TEST_REPORT.v2.md`
Implementation commit: `a73032e Add parent-side Codex imagegen wrapper`

Updated evidence status:

| Area | 2026-06-11 status | Evidence | Next decision |
|---|---|---|---|
| image_gen external command | Partially implemented and live-smoked | `QIVANCE_CODEX_IMAGE_GEN_CMD` can point to `scripts/codex-image-gen-parent-wrapper.ts`; wrapper invokes child `codex exec`, scans Codex `generated_images`, copies output, computes sha256/dimensions, and returns `ImageGenerationResult` | Use this command in the full three-ratio media E2E run |
| child timeout | Implemented | parent wrapper defaults child timeout to 300000 ms and supports `QIVANCE_CODEX_IMAGE_GEN_TIMEOUT_MS`; timeout path covered by tests | Tune timeout per production image complexity if needed |
| adapter contract | Implemented at command boundary | committed-file tests pass for adapter request JSON, missing command fail-fast, generated image discovery, insufficient candidates, and timeout | Add manifest assertions once full workflow writes render manifests |
| live smoke | Passed for one 1:1 request | output `/tmp/qivance-codex-imagegen-parent-live/img_req_parent_smoke_001_v1.png`, 1254x1254, sha256 `3e2c00fd63c660fa2829939ea7bb028d8181a5ff835dcc1b5488607732b0e139` | Run portrait/landscape/square fixtures end-to-end |
| full media E2E | Not yet claimed | TEST_REPORT no longer treats image_gen command absence as the hard blocker, but no passed `projects/media_e2e_v2_*/exports/render_manifest.json` is recorded | Execute downstream html-video runtime/render/mux/ffprobe gates with real generated images |

Requirement status changes:

- R89-R91: move from unimplemented/blocked to partially implemented with direct tests and one live image generation smoke.
- R92-R94: remain partially implemented because lock gate and local asset references are wired, but full html-video/runtime/render evidence after real image generation is still missing.
- R95: unchanged; RAG asset recycling is out of this wrapper fix.

Current hard blocker: full V2 completion now depends on running and passing the downstream three-ratio media E2E gates with `QIVANCE_CODEX_IMAGE_GEN_CMD=/home/jym/workspace/qivance-music/scripts/codex-image-gen-parent-wrapper.ts`. The previous blocker, absence of a real Codex image_gen external command, is resolved for local smoke purposes.
