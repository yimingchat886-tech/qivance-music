# PRD: Staged Delivery Overlay

## Goal

Implement the first layer of the v1.4.1 Staged Delivery Overlay for this repo's local Trellis harness.

This task makes staged delivery usable as an optional governance layer for complex work while preserving the default Trellis flow for ordinary tasks.

## Source

- `/mnt/c/Users/Jym/Downloads/tele/v1_4_1_staged_delivery_overlay_prd.md`

## Requirements

- Write a harness capability report before changing workflow guidance.
- Add project-local staged delivery specs under `.trellis/spec/project/`.
- Add staged delivery templates under `.trellis/templates/staged/`.
- Update `.trellis/spec/guides/index.md` so agents can discover the staged overlay guidance.
- Add a small `.trellis/workflow.md` pointer for staged overlay tasks without introducing new task statuses.
- Keep `default_trellis` tasks on the existing Plan / Execute / Finish flow.
- Do not change `task.py archive`, continue routing, finish-work routing, or the full workflow-state machine.
- Do not touch runtime qivance source code.

## Non-Goals

- No full harness state machine.
- No new real task status writer.
- No physical child archive.
- No Oracle adapter implementation.
- No RTM auto-update helper.
- No push.

## Acceptance Criteria

- [ ] `.trellis/tasks/06-22-staged-delivery-overlay/harness-capability-report.md` records current harness constraints and downgrade decisions.
- [ ] `.trellis/spec/project/index.md` and staged overlay spec files exist.
- [ ] `.trellis/templates/staged/` contains parent, child, report, budget, and RTM templates.
- [ ] `.trellis/spec/guides/index.md` links to the project staged overlay guidance.
- [ ] `.trellis/workflow.md` documents that staged overlay is optional and does not replace default Trellis states.
- [ ] `git diff --check` passes for the task-owned docs/templates.

## Technical Approach

Use documentation and templates only. The existing Trellis status lifecycle remains `planning -> in_progress -> completed`. Staged delivery metadata is recorded under `task.json.meta.workflow_mode` and `task.json.meta.staged_delivery`.

## Out of Scope

- Existing uncommitted chat-dialogue source and test changes.
- Existing backend scheduler contract edits not made by this task.
- Rewriting the existing RTM file path.
