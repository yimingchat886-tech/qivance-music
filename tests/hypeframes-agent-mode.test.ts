import assert from "node:assert/strict";
import test from "node:test";
import { resolveHypeframesAgentMode } from "../src/lib/hypeframes-agent-mode.ts";

test("resolveHypeframesAgentMode defaults to optional WSL Codex mode", () => {
  assert.equal(resolveHypeframesAgentMode({}), "optional_refine");
});
