import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendMediaE2ETestReportEvidence } from "../src/lib/media-e2e/test-report.ts";

test("appends human-readable media E2E report evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qivance-media-e2e-report-"));
  const reportPath = path.join(root, "docs", "TEST_REPORT.v2.md");

  await appendMediaE2ETestReportEvidence({
    reportPath,
    ratio: "portrait-9x16",
    manifestPath: "projects/media_e2e_v2_portrait_9x16/exports/render_manifest.json",
    status: "passed",
  });

  const report = await readFile(reportPath, "utf8");

  assert.match(report, /## portrait-9x16/);
  assert.match(report, /Status: passed/);
  assert.match(report, /render_manifest\.json/);
});
