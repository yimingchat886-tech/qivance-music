# Qivance Music x html-video 子 PRD v6：video_chain、MP4 背景视频与预览优先修订

> 日期：2026-06-17
> 状态：Draft
> 版本目标：在 V5 的上传入口、SQLite + Prisma 控制面和 server 内置 runner 基础上，新增 `video_chain`。内部操作者可以创建项目后进入专用子页面，上传 MP4、MP3 和歌词，生成 timing / section map，进入 html-video 生成以 MP4 为背景的视频卡牌动效，并在预览中通过 LLM 修订效果；`final.mp4` 只通过显式导出动作重新生成。

---

## 1. V6 定位

V6 聚焦一个新的生产链路：

```text
video_chain = MP4 背景视频 + MP3 最终音频 + 歌词/section map + html-video 知识卡牌动效
```

V6 不是 V5 的 UI 重写，也不是 SaaS 化。它继续使用 V5 的 DB-backed project/control-plane/runner，把 V3 已有的 source-video/html-video 能力收敛成一个可测试的产品入口。

---

## 2. 已确认决策

| 编号 | 决策项 | V6 方案 |
|---|---|---|
| D1 | Chain | `video_chain` 是一等 chain registry entry |
| D2 | 入口 | 新建项目后进入 `/projects/:id/video-chain` 子页面 |
| D3 | 输入 | 歌词 + MP3/WAV master audio + MP4 background video |
| D4 | MP3 | MP3/WAV 是 timing 输入和最终音频来源 |
| D5 | MP4 | MP4 是 html-video 内的静音背景视频素材，不作为最终音频 |
| D6 | Timing | 复用 V5 timing pipeline 生成 `data/timing/section_map.json` |
| D7 | html-video | 用真实 html-video agent/runtime 生成 frames |
| D8 | 动效方向 | 在 MP4 背景上叠加知识卡牌、教学 callout、关键词弹出、歌词/节奏同步覆盖层 |
| D9 | LLM 修订 | 修订只刷新 html-video preview，不自动导出 `final.mp4` |
| D10 | Final export | 只有用户显式点击 Render/Export 才重新生成 `exports/video_chain/final.mp4` |
| D11 | 安全门禁 | 每个 video_chain frame 都必须引用锁定的 MP4 背景路径 |
| D12 | 兼容性 | `chat_dialogue_mv` V5 链路保持可用 |

---

## 3. 用户流程

```text
1. 内部操作者打开 /projects
2. 创建 content_type = video_chain 的项目
3. 进入 /projects/:id/video-chain
4. 上传或粘贴歌词
5. 上传 MP3/WAV master audio
6. 上传 MP4 background video
7. 点击 Confirm Inputs
8. server runner 自动执行：
   8.1 timing pipeline
   8.2 source video import
   8.3 video animation plan
   8.4 html-video frame agent
   8.5 visual render
   8.6 MP3 mux final
   8.7 QA report
   8.8 v6 render manifest
9. 子页面展示 html-video preview
10. 用户通过 LLM Revision 提交动效修改
11. 系统只刷新 preview，不更新 final.mp4
12. 用户确认 preview 后点击 Render final.mp4
13. 系统重新 render/mux/QA/manifest，并提供 final.mp4 下载
```

---

## 4. 输入与输出

### 4.1 输入

V6 `video_chain` 接受：

```text
- 歌词：lyrics_text、.md 或 .txt
- 音频：.mp3 或 .wav
- 视频：.mp4
```

输入锁定后的稳定路径：

```text
lyrics.md
active_music_take.mp3
source_video.mp4
data/source/source_video_import.json
```

### 4.2 输出

成功 run 必须产出：

```text
projects/<project_id>/
  lyrics.md
  active_music_take.mp3
  source_video.mp4
  data/source/source_video_import.json
  data/timing/beat_grid.json
  data/timing/onset_events.json
  data/timing/energy_curve.json
  data/timing/lyric_word_timing.json
  data/timing/alignment_report.json
  data/timing/section_map.json
  data/chains/video_chain/video_animation_plan.json
  data/chains/video_chain/frame_contracts.json
  data/chains/video_chain/qa_report.json
  video/html-video/.html-video/projects/<project_id>/frames/**
  exports/video_chain/visual.mp4
  exports/video_chain/final.mp4
  exports/video_chain/render_manifest.json
```

---

## 5. 子页面需求

V6 子页面必须覆盖真实测试所需的最小闭环：

```text
GET /projects/:id/video-chain
```

页面能力：

```text
- 展示当前 project id、root、status
- 展示 active inputs、sha、stable path
- 上传 lyrics / audio / video
- Confirm Inputs
- Run/task/event 状态
- html-video preview iframe
- LLM Revision 表单
- Preview JSON 链接
- Render final.mp4 按钮
- Download final MP4 链接
- Artifact 表
```

LLM Revision 必须明确：

```text
- 只刷新 preview
- 不 render final.mp4
- 不 mux final.mp4
- 不修改 final.mp4
```

---

## 6. API 需求

### 6.1 创建项目

```text
POST /api/projects
```

请求：

```json
{
  "title": "V6 Knowledge Cards",
  "content_type": "video_chain",
  "description": "optional"
}
```

行为：

```text
- 写入 DB Project
- 创建 project root
- 创建 Chain row: video_chain
- 初始化 inputs/video、data/source、data/chains/video_chain、exports/video_chain
- 不启动 scheduler
```

### 6.2 上传输入

```text
POST /api/projects/:id/inputs
```

支持 multipart fields：

```text
- lyrics_text
- lyrics_file
- audio_file
- video_file
- mp4_file
- replace=true
```

### 6.3 确认输入

```text
POST /api/projects/:id/inputs/confirm
```

行为：

```text
- 校验 active lyrics/audio/video 齐全
- 写稳定路径 lyrics.md、active_music_take.mp3、source_video.mp4
- 写 source_video_import.json，audio_policy = background_video_only
- 创建 video_chain scheduler run
- 状态进入 queued
```

### 6.4 Preview

```text
GET /projects/:id/video-chain/preview
GET /api/projects/:id/chains/video-chain/preview
```

### 6.5 LLM Revision

```text
POST /api/projects/:id/chains/video-chain/revise
```

行为：

```text
- 写 revision_request.json
- 运行 html-video revision agent
- 校验 frame contract
- 校验每个 frame 仍引用 source_video.mp4
- 返回刷新后的 preview model
- 不重新生成 final.mp4
```

### 6.6 显式导出

```text
POST /api/projects/:id/chains/video-chain/export/render
GET /api/projects/:id/chains/video-chain/export/final.mp4
```

行为：

```text
- render html-video visual.mp4
- 用 active_music_take.mp3 mux final.mp4
- 写 data/chains/video_chain/qa_report.json
- 写 exports/video_chain/render_manifest.json
- 更新 DB Artifact rows
```

---

## 7. 验收标准

```text
- video_chain 可通过项目创建入口创建
- chat_dialogue_mv 仍可用
- 子页面可以上传 lyrics/audio/video
- 缺任一必需输入时 Confirm Inputs 返回 inputs_incomplete
- 完整输入确认后创建 video_chain scheduler tasks
- timing pipeline 生成 section_map.json
- source_video_import.json 记录 background_video_only
- html-video agent context 引用 MP4 背景和 timing artifacts
- 初次生成和 revision 后，每个 frame 都引用锁定的 MP4 背景路径
- LLM revision 成功后只刷新 preview
- LLM revision 不自动生成 final.mp4
- 显式 export 生成 visual.mp4、final.mp4、qa_report.json、render_manifest.json
- final.mp4 音频来自 active_music_take.mp3
- render_manifest.json schema_version = 6
- 相关 tests/typecheck 通过
```

---

## 8. 非目标

```text
- SaaS、登录、用户、权限
- Cloudflare Access / Tailscale
- DeepSeek 歌词生成
- MiniMax 音乐生成
- 多 take 音频选择
- image_storyboard_mv
- OpenDesign / Next.js 重写
- 模板市场
- 分布式 worker
- 自动把 LLM revision 结果导出成 final.mp4
```
