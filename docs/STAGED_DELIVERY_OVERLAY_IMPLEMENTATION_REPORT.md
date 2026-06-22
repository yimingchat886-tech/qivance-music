# v1.4.1 Staged Delivery Overlay 落地报告

日期：2026-06-22
仓库：`/home/jym/workspace/qivance-music`
来源 PRD：`C:/Users/Jym/Downloads/tele/v1_4_1_staged_delivery_overlay_prd.md`
状态：第一层 overlay 已落地，未 push

## 1. 落地目标

本次目标是实施 v1.4.1 Staged Delivery Overlay 的第一层治理能力，而不是实现完整 Trellis 状态机。

落地后的能力：

- 普通任务继续走默认 Trellis 流程。
- T3/T4、高风险 T2、parent/child、RTM、Oracle、Ponytail、harness/tooling 任务可选择 staged overlay。
- staged overlay 通过 `task.json.meta.workflow_mode = "staged_overlay"` 和 `task.json.meta.staged_delivery` 记录事实。
- child task 使用 soft archive，不调用 built-in `task.py archive` 移动目录。
- commit 和 push 边界明确：完成信号后可 commit，push 必须显式命令。

## 2. 已完成提交

| Commit | Message | 内容 |
|---|---|---|
| `0b605de` | `docs: add staged delivery overlay` | 新增 overlay 规则层、模板层、workflow 入口、guide 索引和 `.gitignore` 模板跟踪规则 |
| `d1ccc5b` | `chore(task): soft archive staged delivery overlay` | 保存本次 task PRD、harness capability report、stage report、JSONL 上下文和 soft archive evidence |

未执行 `git push`。

## 3. 主要改动

### 3.1 Project workflow specs

新增目录：`.trellis/spec/project/`

| 文件 | 用途 |
|---|---|
| `index.md` | project workflow spec 入口 |
| `staged-delivery-overlay.md` | staged overlay 总规则 |
| `task-sizing.md` | T0-T4 任务分级 |
| `pm-intake-protocol.md` | 非平凡需求 PM intake 格式 |
| `oracle-review-policy.md` | Oracle/GPT-5.5 Pro 审查预算与触发策略 |
| `ponytail-boundary.md` | Ponytail blocking/advisory 边界 |
| `rtm-guidelines.md` | RTM Markdown/JSON 规范 |
| `git-commit-push-policy.md` | commit、soft archive、push 边界 |

### 3.2 Staged templates

新增目录：`.trellis/templates/staged/`

| 模板 | 用途 |
|---|---|
| `parent-prd.md` | parent PRD 模板 |
| `conflict-review.md` | 需求冲突审查模板 |
| `oracle-review-budget.md` | Oracle 审查预算模板 |
| `child-prd.md` | child PRD 模板 |
| `child-implement.md` | child PLAN/implement 模板 |
| `stage-report.md` | child 完成报告模板 |
| `subphase-report.md` | parent 子阶段收尾报告模板 |
| `rtm-delta.md` | RTM delta 模板 |

### 3.3 Workflow 入口

更新 `.trellis/workflow.md`：

- 增加 Staged Delivery Overlay 小节。
- 在 `no_task`、`planning`、`planning-inline`、`in_progress`、`in_progress-inline` breadcrumb 中加入 overlay 提示。
- 明确 v1.4.1 不新增自定义状态，不替换内建 `planning -> in_progress -> completed` 生命周期。

### 3.4 Guide index

更新 `.trellis/spec/guides/index.md`：

- 增加 staged overlay 入口。
- 要求 T3/T4、parent/child、RTM、Oracle、soft archive、harness/tooling 任务读取 `.trellis/spec/project/index.md`。

### 3.5 Git ignore

更新 `.gitignore`：

- 放开 `.trellis/templates/` 让 staged 模板可被 Git 跟踪。
- `.trellis/tasks/` 仍保持默认忽略；本次 task evidence 使用 `git add -f` 单独纳入。

## 4. Harness capability 结论

本次先写入了 `.trellis/tasks/06-22-staged-delivery-overlay/harness-capability-report.md`，关键结论如下：

| 检查项 | 当前 harness 行为 | v1.4.1 降级决策 |
|---|---|---|
| workflow state | 当前只可靠支持 `planning`、`in_progress`、`completed` 等内建状态 | 不新增 v2.0 状态机 |
| Phase 3.4 commit | 默认由 AI 在 finish-work 前驱动 commit | staged overlay 只作为 opt-in 规则 |
| `task.py archive` | 会写 `completed`、移动目录、清 session、可能自动提交 | child 使用 soft archive，不调用 built-in archive |
| Codex mode | 当前为 inline mode | 继续主会话执行，不引入 sub-agent 调度 |
| RTM | 现有文件是 `docs/requirements traceability matrix.md` | 记录路径差异，不重命名 |
| Oracle | 仓库内未发现 Oracle adapter | 只落 policy/template，不实现 adapter |
| Ponytail | 已有 Codex/Trellis/Ponytail 标准 | 落 blocking/advisory 边界 |

## 5. 验证记录

| 命令 | 结果 |
|---|---|
| `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-22-staged-delivery-overlay` | pass |
| `git diff --check -- .gitignore .trellis/workflow.md .trellis/spec/guides/index.md .trellis/spec/project .trellis/templates/staged` | pass |
| `rg -n "[ \t]+$" ...` | pass |
| `printf '{}' \| python3 -X utf8 .codex/hooks/inject-workflow-state.py` | pass |
| `python3 ./.trellis/scripts/get_context.py --mode packages` | pass，显示 `backend, project` |
| `/home/jym/.nvm/versions/node/v24.14.0/bin/gitnexus analyze` | pass |

未运行 TypeScript/product tests，因为本次没有修改运行时代码。

## 6. 已明确不做的内容

以下内容按 v1.4.1 PRD 延后到 v2.0 或后续任务：

- 完整状态写入器。
- 完整 workflow state router。
- continue 路由改造。
- finish-work 路由改造。
- true child physical archive。
- archive-parent / archive-child 新命令。
- Oracle adapter 输出 parser。
- 自动 blocker 写入。
- parent/child evidence aggregator。
- RTM auto-update helper。
- Codex sub-agent 调度。
- 完整测试矩阵。

## 7. 当前状态

- 工作提交：`0b605de`
- soft archive evidence 提交：`d1ccc5b`
- Built-in `task.py archive`：未执行
- Push：未执行
- 当前 task 目录：保留在 `.trellis/tasks/06-22-staged-delivery-overlay/`
- 当前 active task：仍指向 staged overlay task，用于保留 evidence

## 8. 后续建议

建议下一步不要直接进入完整状态机，而是先用 staged overlay 跑一次真实 T3/T4 子阶段任务，验证以下流程是否顺手：

1. PM intake 是否足够清楚。
2. Oracle Review Budget 是否能降低长审查成本。
3. child soft archive 是否满足 parent 聚合证据。
4. RTM Markdown/JSON 规范是否够用。
5. commit/push 边界是否符合用户操作习惯。

如果这次真实使用顺畅，再进入 v2.0 harness state machine 设计。
