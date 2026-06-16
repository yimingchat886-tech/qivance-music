# Backend Code Specs

## Scope

Backend specs cover Node-served API routes, file-backed project state, scheduler state, media export helpers, and Workbench data flow.

## Pre-Development Checklist

- Read `v4-chat-scheduler-contracts.md` before changing V4 chat-dialogue chain APIs, scheduler files, render manifest v4, or Workbench scheduler summaries.
- Read `v5-control-plane-runner-contracts.md` before changing V5 project creation, input upload/confirm, Prisma control-plane models, DB-backed scheduler state, V5 task handlers, Workbench V5 controls, or product-entry E2E.

## Quality Check

- Run `npm run typecheck`.
- Run focused tests for changed backend contracts.
- For V4 scheduler/chat changes, include `tests/chat-chain-api.test.ts`, `tests/scheduler-*.test.ts`, `tests/chat-*.test.ts`, and `tests/render-manifest-v4.test.ts`.
- For V5 control-plane/runner changes, include `tests/prisma-control-plane.test.ts`, `tests/chain-registry-v5.test.ts`, `tests/project-*-v5.test.ts`, `tests/server-runner-loop-v5.test.ts`, `tests/timing-pipeline-v5.test.ts`, `tests/chat-dialogue-runner-v5.test.ts`, and `tests/workbench-v5-api.test.ts`.
- Run `git diff --check` before commit.
