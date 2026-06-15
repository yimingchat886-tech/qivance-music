# Backend Code Specs

## Scope

Backend specs cover Node-served API routes, file-backed project state, scheduler state, media export helpers, and Workbench data flow.

## Pre-Development Checklist

- Read `v4-chat-scheduler-contracts.md` before changing V4 chat-dialogue chain APIs, scheduler files, render manifest v4, or Workbench scheduler summaries.

## Quality Check

- Run `npm run typecheck`.
- Run focused tests for changed backend contracts.
- For V4 scheduler/chat changes, include `tests/chat-chain-api.test.ts`, `tests/scheduler-*.test.ts`, `tests/chat-*.test.ts`, and `tests/render-manifest-v4.test.ts`.
- Run `git diff --check` before commit.
