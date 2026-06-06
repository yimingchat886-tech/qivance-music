import test from "node:test";
import assert from "node:assert/strict";
import { ProjectOrchestrator, ProjectStore, EngineRegistry } from "@html-video/core";
import { validate, topoSort, totalDurationSec } from "@html-video/content-graph";
import * as hyperframesAdapter from "@html-video/adapter-hyperframes";

test("imports html-video core, content graph, and Hyperframes adapter packages", () => {
  assert.equal(typeof ProjectStore, "function");
  assert.equal(typeof EngineRegistry, "function");
  assert.equal(typeof ProjectOrchestrator, "function");
  assert.equal(typeof validate, "function");
  assert.equal(typeof topoSort, "function");
  assert.equal(typeof totalDurationSec, "function");
  assert.ok(Object.keys(hyperframesAdapter).length > 0);
});
