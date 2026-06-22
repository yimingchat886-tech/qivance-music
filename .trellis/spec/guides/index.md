# Trellis Guides

## Project Development Standard

- Read `project-development.md` before non-trivial development, process, dependency, verification, or spec work.
- It defines the Codex + Trellis + Ponytail operating standard for this repository.
- It also defines the Ponytail review gate used by the Trellis check phase.
- Use it alongside `.trellis/workflow.md`; the workflow remains authoritative for phase order and active-task handling.

## Staged Delivery Overlay

- Read `../project/index.md` before T3/T4 work, parent/child staged delivery, RTM-tracked work, Oracle review budgeting, soft archive, or harness/tooling changes.
- The staged overlay is opt-in. Ordinary low-risk work keeps using the default Trellis flow.
- The overlay does not add a new task status machine in v1.4.1; use `task.json.meta.workflow_mode = "staged_overlay"` and staged templates for evidence.

## Backend Contract Changes

- If a change adds API routes, scheduler state, export files, or cross-layer artifacts, read `../backend/v4-chat-scheduler-contracts.md`.
- Verify the route, file path, manifest, QA, and Workbench evidence paths match the documented contract.
