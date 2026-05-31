import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadArtifactCatalog, writeArtifactSnapshot } from "../src/lib/artifact-catalog.ts";

test("artifact catalog returns the phase 1 workflow groups", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-groups-"));
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: "project_catalog_groups",
  });

  const groups = await loadArtifactCatalog(projectPath);

  assert.deepEqual(groups.map((group) => group.id), [
    "music_ingest",
    "beat_lock",
    "timing_schema",
    "storyboard_gate",
    "hypeframes_project",
    "wsl_codex_agent",
    "render_preview",
  ]);
  assert.equal(groups.find((group) => group.id === "beat_lock")?.label, "Beat Lock");
  assert.ok(groups.every((group) => group.artifacts.length > 0));
  assert.equal(
    groups
      .find((group) => group.id === "music_ingest")
      ?.artifacts.find((artifact) => artifact.relativePath === "audio/raw/minimax_rap_raw.*")?.exists,
    false,
  );
});

test("artifact catalog marks existing files with metadata and maps QA status", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-metadata-"));
  const lockedBeats = "{\"beats\":[0,1]}";
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: "project_catalog_metadata",
  });
  await writeFileAt(projectPath, "data/timing/beats.locked.json", lockedBeats);
  await writeJson(path.join(projectPath, "qa", "timing", "beat_lock_qa_report.json"), {
    status: "rule_pass_with_warnings",
    warnings: ["Beat confidence is low."],
  });

  const groups = await loadArtifactCatalog(projectPath);
  const beatGroup = groups.find((group) => group.id === "beat_lock");
  const beatArtifact = beatGroup?.artifacts.find(
    (artifact) => artifact.relativePath === "data/timing/beats.locked.json",
  );

  assert.equal(beatGroup?.status, "warning");
  assert.equal(beatArtifact?.exists, true);
  assert.equal(beatArtifact?.sizeBytes, Buffer.byteLength(lockedBeats));
  assert.equal(beatArtifact?.sha256, sha256(lockedBeats));
  assert.equal(beatArtifact?.contentType, "application/json; charset=utf-8");
});

test("artifact catalog treats partial artifacts without QA as running", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-running-"));
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: "project_catalog_running",
  });
  await writeFileAt(projectPath, "hypeframes/src/index.html", "<!doctype html>");

  const groups = await loadArtifactCatalog(projectPath);

  assert.equal(groups.find((group) => group.id === "hypeframes_project")?.status, "running");
  assert.equal(groups.find((group) => group.id === "music_ingest")?.status, "pending");
});

test("artifact catalog expands raw audio glob artifacts", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-glob-"));
  await writeFileAt(projectPath, "audio/raw/minimax_rap_raw.mp3", "raw");

  const groups = await loadArtifactCatalog(projectPath);
  const rawAudio = groups
    .find((group) => group.id === "music_ingest")
    ?.artifacts.find((artifact) => artifact.relativePath === "audio/raw/minimax_rap_raw.mp3");

  assert.equal(rawAudio?.exists, true);
  assert.equal(rawAudio?.contentType, "application/octet-stream");
});

test("artifact catalog ignores raw audio backup files without the dotted prefix", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-glob-backup-"));
  await writeFileAt(projectPath, "audio/raw/minimax_rap_raw_backup.txt", "backup");

  const groups = await loadArtifactCatalog(projectPath);
  const musicArtifacts = groups.find((group) => group.id === "music_ingest")?.artifacts ?? [];

  assert.equal(
    musicArtifacts.find((artifact) => artifact.relativePath === "audio/raw/minimax_rap_raw.*")?.exists,
    false,
  );
  assert.equal(
    musicArtifacts.some((artifact) => artifact.relativePath === "audio/raw/minimax_rap_raw_backup.txt"),
    false,
  );
});


test("artifact catalog can skip hashes for lightweight progress reads", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-nohash-"));
  await writeFileAt(projectPath, "data/timing/beats.locked.json", "{\"beats\":[0,1]}");

  const groups = await loadArtifactCatalog(projectPath, { includeHashes: false });
  const beatArtifact = groups
    .find((group) => group.id === "beat_lock")
    ?.artifacts.find((artifact) => artifact.relativePath === "data/timing/beats.locked.json");

  assert.equal(beatArtifact?.exists, true);
  assert.equal(beatArtifact?.sha256, null);
});

test("artifact catalog writes an artifact manifest snapshot", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-snapshot-"));
  await writeJson(path.join(projectPath, "project_manifest.json"), {
    project_id: "project_catalog_snapshot",
  });
  await writeFileAt(projectPath, "audio/music_manifest.json", "{\"duration_sec\":4}");

  await writeArtifactSnapshot(projectPath);

  const snapshot = JSON.parse(await readFile(path.join(projectPath, "artifact_manifest.json"), "utf8"));
  assert.equal(snapshot.project_id, "project_catalog_snapshot");
  assert.equal(typeof snapshot.updated_at, "string");
  assert.equal(snapshot.groups.length, 7);
  assert.equal(snapshot.groups[0].id, "music_ingest");
});

test("artifact catalog snapshot falls back to project directory name without a manifest", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-artifacts-snapshot-fallback-"));

  await writeArtifactSnapshot(projectPath);

  const snapshot = JSON.parse(await readFile(path.join(projectPath, "artifact_manifest.json"), "utf8"));
  assert.equal(snapshot.project_id, path.basename(projectPath));
  assert.equal(snapshot.groups.length, 7);
});

async function writeFileAt(projectPath: string, relativePath: string, value: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
