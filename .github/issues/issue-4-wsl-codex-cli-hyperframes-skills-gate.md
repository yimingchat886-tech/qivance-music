# Issue #4: 接入 WSL Codex CLI、HyperFrames Skills 与 Gate 强化

> Source of truth: `docs/issue4_codex_executable_requirements.md`  
> Target repo: `yimingchat886-tech/qivance-music`  
> Suggested branch: `codex/issue-4-wsl-codex-hyperframes-gates`  
> Status: executable implementation issue

## Goal

让后端以可审计、可回退、可阻断的方式接入 **WSL 内部 Codex CLI**，让 Codex 基于项目内的 **HyperFrames repo-scoped skills** 修订 `hypeframes/` composition。所有 prompt、JSONL、stderr、final message、diff、changed files、skills、QA report 都必须落盘为项目中间产物；任何 blocking Gate 失败都不得进入 preview render。

## Baseline

当前 `main` 已经有：

- 本地 Node 24 / TypeScript MVP，不引入 Next.js、Prisma、队列、Redis 或数据库迁移。
- 上传/导入项目、生成 timing/storyboard/HypeFrames project、人工按钮审批、preview render、final approve。
- `GET /projects/:id/hyperframes` 独立页面。
- `artifact-catalog.ts` 的 6 个 artifact group。
- `gate-progress.ts` 的 gate progress 展示。

Issue #4 只在现有 closed loop 上增强 WSL Codex、skills、Gate、artifact visibility，不重做产品流程。

## Hard Boundaries

- 不自动安装 WSL / Codex CLI / HyperFrames CLI。
- 不读取、复制、输出 `~/.codex/auth.json`。
- 不把 `OPENAI_API_KEY`、`CODEX_API_KEY`、authorization、token、password、secret 写入日志、QA 或 manifest。
- 不把 Windows host 的 `codex.exe`、`codex.cmd`、`codex.ps1`、PowerShell shim 当作有效 Codex CLI。
- 不做通用 executable resolver；本 issue 只接入 WSL 内部 Codex。
- 不扫描整个 home 目录，不扫描 `~/.npm/_npx`。
- 不让 Codex 修改 timing/audio/truth/render 产物。
- 不使用 `danger-full-access`，不默认使用 `--skip-git-repo-check`。
- 不引入 LLM 自查内容质量；主观判断仍交给人工审批。
- 不实现后台队列；同步执行可以接受，但必须写清中间产物和进度。

## Forbidden Paths

Codex agent 不得新增、修改或删除：

```text
audio/**
data/timing/**
data/lyrics/**
project_manifest.json
workflow_snapshot.json
dist/**
qa/music/**
qa/timing/**
```

允许修改：

```text
hypeframes/**
qa/hypeframes/hypeframes_revision_notes.md
logs/codex/**
```

## Environment

新增配置：

```text
QIVANCE_HYPEFRAMES_AGENT=off | wsl_codex_optional | wsl_codex_required

QIVANCE_WSL_EXE=wsl.exe
QIVANCE_WSL_DISTRO=Ubuntu
QIVANCE_WSL_USER=<optional>
QIVANCE_WSL_CODEX_BIN=codex
QIVANCE_WSL_PROJECT_ROOT=<optional>
QIVANCE_CODEX_MODEL=<optional>
```

默认：

```text
QIVANCE_HYPEFRAMES_AGENT=wsl_codex_optional
QIVANCE_WSL_EXE=wsl.exe
QIVANCE_WSL_CODEX_BIN=codex
```

Mode behavior:

| Mode | Behavior |
|---|---|
| `off` | 不检测 WSL Codex，不运行 Codex，只跑 deterministic HypeFrames flow |
| `wsl_codex_optional` | 检测 WSL Codex；不可用时写 warning QA，继续 deterministic flow |
| `wsl_codex_required` | 检测 WSL Codex；不可用时写 blocking QA，阻断 render |

## Target Workflow

`server.ts` 与 `src/cli/run-workflow.ts` 必须走同一段 approved-scene-to-preview workflow：

```text
approveScenePlan()
-> generateHypeframesProject()
-> runHypeframesFileGate()
-> optional/required runHypeframesCodexAgent()
-> runCodexForbiddenPathGate()
-> runHypeframesFileGate()
-> renderPreview()
```

建议抽出：

```text
src/lib/video-preview-workflow.ts
```

任一 required Gate 为 `rule_fail_blocked` 时，必须停止在 render 前。

## Implementation Scope

### 1. Shared QA / StepRun primitives

Create:

```text
src/lib/gate-report.ts
src/lib/step-run-log.ts
src/lib/project-file-snapshot.ts
```

Requirements:

- `writeQaReport()` 统一写 `created_at`、`reviewer_type`、`gate_name`、`status`、`blocking_issues`、`warnings`、`auto_fixes_applied`、`input_artifacts`、`output_artifacts`。
- `metadata` 必须经过 secret scrub。
- `appendStepRun()` 写入 `logs/step_runs.jsonl`，不得记录 secrets。
- `snapshotProjectFiles()` 与 `diffProjectFileSnapshots()` 用于 forbidden path Gate。
- `post-minimax-workflow.ts` 复用共享 report / StepRun，不保留重复实现。

### 2. WSL command, path, and Codex detection

Create:

```text
src/lib/wsl-command.ts
src/lib/wsl-path.ts
src/lib/wsl-codex-detect.ts
```

Detection flow:

```text
wsl.exe --status
wsl.exe --list --verbose
wslpath -a '<projectPath>'
command -v "$QIVANCE_WSL_CODEX_BIN"
"$CODEX_PATH" --version
"$CODEX_PATH" exec --help
```

Outputs:

```text
logs/codex/wsl_codex_detection.json
qa/hypeframes/wsl_codex_availability_qa_report.json
```

Do not inspect Windows Codex shims. Do not run install commands.

### 3. HyperFrames repo-scoped skills

Create:

```text
src/lib/hypeframes-skills.ts
```

It must generate:

```text
hypeframes/.agents/skills/hyperframes-composition/SKILL.md
hypeframes/.agents/skills/hyperframes-composition/references/project-contract.md
hypeframes/.agents/skills/hyperframes-render-cli/SKILL.md
hypeframes/.agents/skills/hyperframes-render-cli/references/render-targets.md
hypeframes/.agents/skills/hyperframes-gate-repair/SKILL.md
hypeframes/.agents/skills/hyperframes-gate-repair/references/gate-contract.md
qa/hypeframes/hyperframes_skills_qa_report.json
```

Skills must state:

- `beats.locked.json` is the single timing truth.
- Only `hypeframes/**` and allowed notes/logs may be modified.
- No external URLs.
- No non-reproducible randomness.
- Preview-first; review-only markers cannot leak into preview target.
- Gate repair only fixes reported Gate failures and does not redesign content.

### 4. WSL Codex runner and HypeFrames agent

Create:

```text
src/lib/wsl-codex-runner.ts
src/lib/hypeframes-agent-prompt.ts
src/lib/hypeframes-codex-agent.ts
```

Codex execution must run inside WSL with cwd:

```text
<projectPathWsl>/hypeframes
```

Command shape:

```bash
codex exec --json --sandbox workspace-write -
```

Prompt must be passed through stdin, not command arguments.

Each run writes:

```text
logs/codex/run_<id>.prompt.md
logs/codex/run_<id>.stdout.jsonl
logs/codex/run_<id>.stderr.log
logs/codex/run_<id>.final.md
logs/codex/run_<id>.summary.json
logs/codex/run_<id>.diffstat.txt
logs/codex/run_<id>.changed_files.json
logs/codex/latest.prompt.md
logs/codex/latest.stdout.jsonl
logs/codex/latest.stderr.log
logs/codex/latest.final.md
logs/codex/latest.summary.json
logs/codex/latest.diffstat.txt
logs/codex/latest.changed_files.json
```

Before running Codex, initialize `projectPath/hypeframes/.git` if needed and commit a deterministic baseline. After running, record `git diff --name-only` and `git diff --stat`.

### 5. Gate strengthening

Create:

```text
src/lib/timing-schema-gate.ts
src/lib/scene-rule-gate.ts
src/lib/hypeframes-file-gate.ts
src/lib/codex-forbidden-path-gate.ts
```

Required report paths:

```text
qa/timing/timing_qa_report.json
qa/storyboard/scene_rule_check.json
qa/hypeframes/hypeframes_file_qa_report.json
qa/hypeframes/codex_forbidden_path_qa_report.json
```

Rules:

- Timing Gate blocks hash mismatch, non-monotonic beats/bars, section overlap, and out-of-range timing.
- Scene Rule Gate blocks missing required fields, invalid scene/caption timing, and invalid templates; pure atmosphere / density / bar alignment issues are warnings unless they break the contract.
- HypeFrames File Gate blocks missing required files, missing render targets, external URLs, missing audio path, duration mismatch, timeline hash mismatch, preview/review marker mismatch, blocking skills QA, and blocking Codex forbidden path Gate.
- Codex Forbidden Path Gate blocks any Codex change to forbidden paths, including deletion.

### 6. Artifact catalog, progress, and HyperFrames page

Modify:

```text
src/lib/artifact-catalog.ts
src/lib/gate-progress.ts
src/lib/web-ui.ts
src/server.ts
```

Requirements:

- Add artifact group `wsl_codex_agent`.
- Add HyperFrames skills, Codex logs, and forbidden path QA artifacts.
- Add progress steps:
  - `hyperframes_skills`
  - `wsl_codex_agent`
  - `codex_forbidden_path`
- Fix `completedFromReportStatus()` so `running` is not completed.
- `/projects/:id/hyperframes` displays WSL Codex detection, skills, latest Codex logs, forbidden path Gate, HypeFrames File QA, and Render QA.
- Existing iframe/runtime/download behavior must remain available.

Manual routes are optional for this issue:

```text
POST /projects/:id/hyperframes/codex-agent/run
POST /projects/:id/hyperframes/file-gate/run
```

## Tests

Add or update `node:test` coverage:

```text
tests/wsl-command.test.ts
tests/wsl-path.test.ts
tests/wsl-codex-detect.test.ts
tests/hypeframes-skills.test.ts
tests/wsl-codex-runner.test.ts
tests/codex-forbidden-path-gate.test.ts
tests/timing-schema-gate.test.ts
tests/scene-rule-gate.test.ts
tests/hypeframes-file-gate.test.ts
tests/artifact-catalog.test.ts
tests/gate-progress.test.ts
tests/post-minimax-workflow.test.ts
tests/web-ui.test.ts
```

Tests must use fake WSL / fake process execution where appropriate. Do not require real WSL or real Codex CLI in unit tests.

Run:

```bash
TMPDIR=/tmp npm test
```

## Acceptance Criteria

- `TMPDIR=/tmp npm test` passes.
- `npm run dev` starts.
- Existing import -> preview -> scene approval -> preview approval workflow does not regress.
- `QIVANCE_HYPEFRAMES_AGENT=off` skips WSL/Codex and keeps deterministic preview behavior.
- `wsl_codex_optional` + unavailable Codex writes warning QA and continues if HypeFrames File Gate passes.
- `wsl_codex_required` + unavailable Codex writes blocking QA and does not enter render.
- Available Codex runs in WSL, cwd `<projectPathWsl>/hypeframes`, with stdin prompt and `workspace-write` sandbox.
- Codex run artifacts and latest pointers are downloadable through artifact catalog.
- HyperFrames skills are generated and visible.
- Codex cannot modify forbidden paths without blocking the workflow.
- HypeFrames File Gate runs before render and again after Codex.
- `running` is no longer displayed as completed in gate progress.
- No secrets or Codex auth contents are written to project files.

## Recommended PR Slices

This issue is large. Prefer small PRs if one diff becomes risky:

1. Shared QA / StepRun / snapshots.
2. Artifact catalog + gate progress + `running` completion fix.
3. WSL command/path/Codex detection.
4. HyperFrames skills generation and skills QA.
5. Codex runner + agent prompt + Codex logs.
6. Timing / scene / HypeFrames file / forbidden path Gates.
7. Workflow integration + HyperFrames page enhancements.

Each slice must keep `TMPDIR=/tmp npm test` passing.

## Implementation Notes

- Before editing existing symbols, follow repo AGENTS instructions and run GitNexus impact analysis.
- Before committing, run `npx gitnexus detect-changes --repo qivance-music`.
- Keep changes surgical. Do not refactor unrelated code.
- Use the long source document for exact TypeScript type signatures and detailed Gate field contracts.
