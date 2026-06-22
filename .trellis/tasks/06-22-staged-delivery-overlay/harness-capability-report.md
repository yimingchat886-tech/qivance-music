# Harness Capability Report: v1.4.1 Staged Delivery Overlay

## Scope

This report checks the local Trellis harness before landing the first-layer staged delivery overlay. It records what exists today, what conflicts with the v1.4.1 PRD, and the downgrade path used by this task.

## Current Harness Facts

| Check | Current behavior | Overlay decision |
|---|---|---|
| Workflow states | `.trellis/workflow.md` defines `no_task`, `planning`, `planning-inline`, `in_progress`, `in_progress-inline`, and `completed`. | Do not add the v2.0 state machine in v1.4.1. |
| Phase 3.4 commit | Current workflow requires the AI to drive a commit before `/finish-work`. | Document staged overlay completion-signal semantics as an optional mode; do not rewrite Phase 3.4 globally. |
| `/finish-work` | `.agents/skills/trellis-finish-work/SKILL.md` says code commits happen before finish-work; finish-work archives task(s) and records journal. | Keep existing finish-work behavior. |
| `task.py archive` | `cmd_archive` writes `status=completed`, moves the task to archive, clears sessions, and may auto-commit archive paths. | Do not use physical child archive for staged overlay child tasks; use soft archive metadata. |
| `completed` reachability | Current workflow notes `completed` is effectively dead after archive because the task directory moves and active resolver loses the pointer. | Do not model staged child completion as built-in `completed`. |
| Parent/children support | `task.py create --parent`, `add-subtask`, and `remove-subtask` maintain `parent` and `children` fields. | Use existing links only as relationship metadata; no parent evidence aggregator in v1.4.1. |
| Codex mode | `.trellis/config.yaml` documents Codex default `dispatch_mode: inline`; no explicit override is set. | Keep main-session docs/template implementation. |
| Hooks | `.codex/hooks/inject-workflow-state.py` parses workflow-state blocks from `.trellis/workflow.md`; it does not advance custom statuses. | Workflow pointers only; no custom state blocks without writers. |
| RTM | Existing file is `docs/requirements traceability matrix.md`, while v1.4.1 proposes `docs/requirements-traceability-matrix.md` and `.json`. | Record the naming mismatch; do not move or rewrite the existing RTM in this task. |
| Oracle | No local Oracle harness files were found in this repo. | Document Oracle policy and budget templates only. |
| Ponytail | Ponytail guidance exists through the current Codex mode and prior Trellis standard task material. | Document staged blocking/advisory boundaries. |
| Test commands | `package.json` exposes `typecheck`, `test`, `test:v5`, `test:v6`, `test:backend`, and `e2e:v6`. | For docs/templates, use `git diff --check` and file inspection. |

## Conflict Points

- v1.4.1 wants staged completion signals, but default Phase 3.4 still commits after verification. This task documents staged overlay as an opt-in mode instead of changing global commit behavior.
- v1.4.1 wants soft archive for child tasks, but current `task.py archive` is physical archive. This task defines soft archive metadata and templates only.
- v1.4.1 wants Oracle checkpoints, but no Oracle adapter exists. This task defines policy and budget templates only.
- v1.4.1 wants RTM Markdown/JSON paths, but the repo already has a Markdown RTM with a spaced filename. This task does not rename it.

## Recommended Downgrade

Land v1.4.1 as a project-local overlay:

1. Specs describe when staged overlay applies.
2. Templates give parent/child tasks a consistent artifact shape.
3. Workflow docs point agents to the overlay without changing task statuses.
4. Scripts and real state-machine changes remain v2.0 work.
