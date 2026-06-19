# Trellis Guides

## Project Development Standard

- Read `project-development.md` before non-trivial development, process, dependency, verification, or spec work.
- It defines the Codex + Trellis + Ponytail operating standard for this repository.
- It also defines the Ponytail review gate used by the Trellis check phase.
- Use it alongside `.trellis/workflow.md`; the workflow remains authoritative for phase order and active-task handling.

## Backend Contract Changes

- If a change adds API routes, scheduler state, export files, or cross-layer artifacts, read `../backend/v4-chat-scheduler-contracts.md`.
- Verify the route, file path, manifest, QA, and Workbench evidence paths match the documented contract.
