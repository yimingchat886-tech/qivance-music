# Qivance Music x html-video 子 PRD v5：上传入口、SQLite 控制面与内置调度执行

> 日期：2026-06-15
> 状态：Draft
> 版本目标：在 V4 已完成的 `chat_dialogue_mv` 文件合同、scheduler 计划/队列和链路级 render/export 基础上，补齐内部产品入口、SQLite + Prisma 控制面、server 内置 runner loop，使内部操作者可以通过 Workbench 创建项目、上传歌词和音频、确认输入后自动跑 timing pipeline 与聊天 MV 链路。

---

## 1. V5 定位

V5 聚焦两件事：

```text
1. 产品入口能力：
   内部操作者可以创建项目，上传歌词和音频，确认输入后进入自动执行。

2. 调度执行能力：
   scheduler 从 V4 的 file-backed local tick 进化为 server 内置 runner loop，
   并通过 SQLite + Prisma 记录项目、输入、artifact、chain、run、task、event 状态。
```

V5 仍是内部使用工具；SaaS 功能取消，不做登录、用户体系、复杂权限、Cloudflare Access 或 Tailscale。

---

## 2. 已确认决策

| 编号 | 决策项 | V5 方案 |
|---|---|---|
| D1 | 产品入口 | 两步创建：先创建空项目，再上传歌词和音频 |
| D2 | P0 输入 | `lyrics_text` / `lyrics_file` + `audio_file` |
| D3 | 启动条件 | 上传后必须由用户确认输入，确认后自动创建 scheduler run |
| D4 | Timing | production 主路径自动跑 timing pipeline；diagnostic fallback 不能计入成功 |
| D5 | 数据库 | SQLite + Prisma |
| D6 | DB 责任 | DB 是控制面；媒体文件和 JSON artifacts 仍在项目目录 |
| D7 | Runner | Node server 内置 runner loop |
| D8 | 输入替换 | 允许显式 `replace=true`，但 `queued` / `running` / `stopping` 时禁止替换 |
| D9 | 一致性校验 | 上传时校验 + 最终 manifest 校验；不做每个 task 前 sha 校验 |
| D10 | 输入冻结 | 用户确认输入后锁定当前 lyrics/audio；开始流程后不允许修改，除非用户先停止 run |
| D11 | Stop | graceful stop：当前 task 收尾，不启动下一 task |
| D12 | Workbench | 最小内部 Workbench，不做新版高保真 UI |
| D13 | Chain registry | 做可扩展 registry；P0 只启用 `chat_dialogue_mv` |
| D14 | Chain 方向 | `image_storyboard_mv` 从后续产品路线删除；下一版本再做 `video_chain` |
| D15 | 延后/取消 | SaaS 取消；登录/权限/Cloudflare/Tailscale、模板资源产品化延后 |

---

## 3. 用户流程

```text
1. 内部操作者创建空项目
2. 上传或粘贴歌词
3. 上传音频
4. Workbench 显示输入 sha、文件名、状态
5. 用户确认输入
6. 系统锁定当前 lyrics/audio
7. server runner 自动创建并执行 scheduler run
8. timing pipeline 生成 timing bundle
9. chat_dialogue_mv chain 生成聊天 MV artifacts
10. render/mux/QA/manifest 通过后，Workbench 显示 final MP4 下载入口
```

---

## 4. 输入与输出

### 4.1 输入

V5 P0 只接受：

```text
- 歌词：粘贴文本、.md 或 .txt
- 音频：.mp3 或 .wav
```

输入不包括：

```text
- DeepSeek 歌词生成
- MiniMax 音乐生成
- 多音频 take 选择
- PDF / Word / 网页 / 视频字幕导入
- source video 输入
```

### 4.2 输出

成功 run 必须产出：

```text
projects/<project_id>/
  lyrics.md
  active_music_take.mp3
  data/timing/beat_grid.json
  data/timing/onset_events.json
  data/timing/energy_curve.json
  data/timing/lyric_word_timing.json
  data/timing/alignment_report.json
  data/timing/section_map.json
  data/chains/chat_dialogue_mv/lyrics_line_map.json
  data/chains/chat_dialogue_mv/speaker_attribution.json
  data/chains/chat_dialogue_mv/conversation_plan.json
  data/chains/chat_dialogue_mv/frame_contracts.json
  data/chains/chat_dialogue_mv/qa_report.json
  exports/chat_dialogue_mv/visual.mp4
  exports/chat_dialogue_mv/final.mp4
  exports/chat_dialogue_mv/render_manifest.json
```

---

## 5. API 需求

### 5.1 创建项目

```text
POST /api/projects
```

请求：

```json
{
  "title": "RAG Rap Lesson",
  "content_type": "chat_dialogue_mv",
  "description": "optional"
}
```

行为：

```text
- 写入 DB Project
- 创建 project root
- 初始化 chain 状态为 input_required
- 不启动 scheduler
```

### 5.2 上传输入

```text
POST /api/projects/:id/inputs
```

支持 multipart fields：

```text
- lyrics_text
- lyrics_file
- audio_file
- replace=true
```

规则：

```text
- 可分多次上传
- lyrics 和 audio 都存在后状态变为 input_uploaded
- 默认不允许覆盖已有输入
- replace=true 只能在非 queued/running/stopping 状态使用
- 上传时计算 sha256 并写 DB
```

### 5.3 确认输入

```text
POST /api/projects/:id/inputs/confirm
```

行为：

```text
- 校验 lyrics + audio 齐全
- 锁定当前 active input
- 写稳定路径 lyrics.md 和 active_music_take.mp3
- 创建 scheduler run
- 状态进入 queued
```

### 5.4 Graceful stop

```text
POST /api/projects/:id/runs/:runId/stop
```

行为：

```text
- run 进入 stopping
- 当前 task 继续收尾
- runner 不启动下一 task
- 未开始 task 标记 stopped
- 已产出 artifacts 保留
```

---

## 6. SQLite + Prisma 控制面

数据库不保存媒体大文件，只保存控制面和索引。

建议模型：

```text
Project
- id
- title
- content_type
- status
- project_root
- created_at
- updated_at

ProjectInput
- id
- project_id
- kind: lyrics | audio
- status: active | superseded
- original_name
- path
- stable_path
- sha256
- mime
- created_at

Artifact
- id
- project_id
- chain_id
- kind
- path
- sha256
- schema_version
- status: current | stale
- created_by_run_id
- created_at

Chain
- id
- project_id
- chain_id
- status
- metrics_json
- last_error
- updated_at

SchedulerRun
- id
- project_id
- status
- mode
- priority
- stop_requested
- created_at
- updated_at

SchedulerTask
- id
- run_id
- project_id
- chain_id
- stage
- status
- dependencies_json
- resource_requirements_json
- input_artifacts_json
- output_artifacts_json
- last_error
- started_at
- finished_at

SchedulerEvent
- id
- run_id
- task_id
- event_type
- message
- details_json
- created_at
```

DB 与文件关系：

```text
- DB 记录 path + sha256 + status
- 文件系统保存实际 lyrics/audio/timing/frames/mp4/manifest
- 最终 manifest 必须校验 locked input sha 与 DB 记录一致
- 若最终校验不一致，run 失败为 artifact_inconsistent
```

---

## 7. Project File Layout

```text
projects/<project_id>/
  inputs/
    lyrics/
      lyrics_<timestamp>.md
    audio/
      active_music_take_<timestamp>.mp3
  lyrics.md
  active_music_take.mp3
  data/
    timing/
    chains/
      chat_dialogue_mv/
  video/
    html-video/
  exports/
    chat_dialogue_mv/
```

`lyrics.md` 和 `active_music_take.mp3` 是稳定路径，用于兼容 V2-V4 既有链路。

替换输入时：

```text
- 旧版本文件保留
- ProjectInput 旧记录标记 superseded
- 当前稳定路径更新到新输入
- 已有 downstream artifacts 标记 stale
- 重新确认后创建新的 scheduler run
```

---

## 8. Server Runner Loop

Node server 启动时启动内置 runner loop。

Runner 行为：

```text
- 扫描 queued / ready / running-stale tasks
- 按 chain registry 生成 task plan
- 按依赖和 resource locks 选择 task
- 执行 task handler
- 写 SchedulerTask 状态和 SchedulerEvent
- 写 Artifact 记录
- 发现 stop_requested 后不再启动下一 task
- server 重启后恢复未完成 run
```

V5 resource locks：

```text
- audio_analysis
- whisperx_alignment
- html_video_agent
- chromium_render
- ffmpeg_mux
- image_generation（保留类型，P0 chat 主路径不要求使用）
```

---

## 9. Timing Pipeline

确认输入后，production 主路径必须自动跑 timing pipeline。

必须产出：

```text
- beat_grid.json
- onset_events.json
- energy_curve.json
- lyric_word_timing.json
- alignment_report.json
- section_map.json
```

失败状态：

```text
- timing_blocked：本机缺 Python / WhisperX / ffmpeg / ffprobe 等依赖
- timing_failed：分析、alignment 或质量门禁失败
```

diagnostic fallback 只用于调试，不计入 production success。

---

## 10. Chain Registry

V5 做可扩展 chain registry，但 P0 只启用 `chat_dialogue_mv`。

P0 registry 示例：

```json
{
  "chain_id": "chat_dialogue_mv",
  "display_name": "Chat Dialogue MV",
  "enabled": true,
  "input_requirements": ["lyrics", "audio"],
  "required_timing": true,
  "stages": [
    "run_timing_pipeline",
    "build_lyrics_line_map",
    "build_speaker_attribution",
    "build_conversation_plan",
    "build_chat_frames",
    "render_visual",
    "mux_final",
    "qa_report",
    "write_manifest"
  ],
  "output_artifacts": [
    "exports/chat_dialogue_mv/final.mp4",
    "exports/chat_dialogue_mv/render_manifest.json"
  ]
}
```

链路方向决策：

```text
- chat_dialogue_mv 是 V5 P0 唯一启用链路
- image_storyboard_mv 从后续产品路线删除，不再作为待补链路
- video_chain 作为下一版本候选链路，不进入 V5 验收
```

---

## 11. 最小内部 Workbench

V5 Workbench P0 必须支持：

```text
- 项目列表
- 新建项目
- 上传 / 粘贴歌词
- 上传音频
- 显示 input sha、文件名、状态
- Confirm inputs
- run/task/event 状态表
- Graceful stop
- final MP4 下载
- manifest / QA report 链接
- timing/render/manifest 错误展示
```

不做：

```text
- 登录
- 权限
- 高保真设计系统
- OpenDesign / Next.js 重写
- timeline editor
- source editor
- template marketplace
```

---

## 12. 状态机

项目/链路状态建议：

```text
draft
input_required
input_uploaded
input_confirmed
queued
running
stopping
stopped
blocked
failed
passed
```

输入替换规则：

```text
- draft/input_required/input_uploaded/stopped/failed 可 replace=true
- input_confirmed/queued/running/stopping 不允许替换
- passed 后允许 replace=true 创建新 run，但旧成功 artifacts 保留为历史
```

---

## 13. 验收标准

V5 P0 完成时必须满足：

```text
- 可以通过 Workbench 创建空项目
- 可以上传或粘贴歌词
- 可以上传 mp3/wav 音频
- 上传时记录 sha256、mime、原始文件名和 project-relative path
- 用户确认输入前不启动 scheduler
- 用户确认输入后自动创建 scheduler run
- runner loop 自动执行 timing pipeline
- runner loop 自动执行 chat_dialogue_mv chain
- final.mp4、render_manifest.json、qa_report.json 产出
- final manifest 校验 locked input sha 与 DB 记录一致
- 运行中禁止替换输入
- graceful stop 不强杀当前 task，且不启动下一 task
- stopped 后可以 replace=true 替换输入并创建新 run
- server 重启后可以恢复 queued/running-stale run
- Workbench 可以查看 run/task/event 和失败原因
- image_storyboard_mv 不作为 V5 P0 或后续待补链路
- video_chain 只作为下一版本方向记录
```

---

## 14. 非目标

V5 不做：

```text
- SaaS
- 登录 / 用户体系 / 复杂权限
- Cloudflare Access / Tailscale
- DeepSeek 歌词生成
- MiniMax 音乐生成
- 多音频 take 选择
- PDF / Word / 网页 / 视频字幕导入
- OpenDesign / Next.js 重写
- 模板市场 / Qivance rap 模板包产品化
- resources.zip
- video_chain（下一版本再做）
- image_storyboard_mv
- 分布式 worker / 多机器调度
```

---

## 15. 实施计划

建议拆分：

```text
Task 1: Prisma schema + SQLite init
Task 2: Project create API + DB-backed project list/detail
Task 3: Input upload + confirm inputs + file layout
Task 4: Chain registry P0
Task 5: Server runner loop + graceful stop
Task 6: Timing pipeline task handlers
Task 7: chat_dialogue_mv task handlers
Task 8: Workbench v5 minimal UI
Task 9: V5 E2E: create -> upload -> confirm -> timing -> chat final MP4
Task 10: TEST_REPORT.v5 + traceability update
```
