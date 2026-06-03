import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeJson } from "./fs-utils.ts";
import { writeQaReport } from "./gate-report.ts";
import { loadHyperframesSkillsResource, type HyperframesSkillsResource } from "./hyperframes-skills-resource.ts";

export type HyperframesSkillsCacheStatus = "created" | "reused" | "updated" | "failed";

export type HyperframesSkillsPrepareResult = {
  name: string;
  version: string;
  hash: string;
  source: string;
  cacheStatus: HyperframesSkillsCacheStatus;
  preparedAt: string;
  skillPaths: string[];
  qaReportPath: string;
  statusPath: string;
};

type EnsureHyperframesSkillsOptions = {
  resource?: HyperframesSkillsResource;
};

const cacheRootRelativePath = "hypeframes/.agents/skills";
const statusPath = "qa/hypeframes/hyperframes_skills_status.json";
const qaReportPath = "qa/hypeframes/hyperframes_skills_qa_report.json";

export async function ensureHyperframesSkills(
  projectPath: string,
  options: EnsureHyperframesSkillsOptions = {},
): Promise<HyperframesSkillsPrepareResult> {
  const resource = options.resource ?? await loadHyperframesSkillsResource();
  const skillPaths = resource.files
    .filter((file) => file.relativePath.endsWith("/SKILL.md"))
    .map((file) => path.posix.join(cacheRootRelativePath, file.relativePath));
  const preparedAt = new Date().toISOString();

  let cacheStatus: HyperframesSkillsCacheStatus;
  let blockingIssues: string[];
  try {
    cacheStatus = await prepareCache(projectPath, resource);
    blockingIssues = await validateSkills(projectPath, skillPaths);
  } catch (error) {
    const failureReason = "Failed to prepare HyperFrames skills: " + errorMessage(error);
    await writeSkillsAudit(projectPath, resource, "failed", skillPaths, preparedAt, false, failureReason, [failureReason]);
    throw new Error(failureReason);
  }

  const success = blockingIssues.length === 0;
  const failureReason = success ? null : blockingIssues.join(" ");
  await writeSkillsAudit(projectPath, resource, cacheStatus, skillPaths, preparedAt, success, failureReason, blockingIssues);
  return {
    name: resource.name,
    version: resource.version,
    hash: resource.hash,
    source: resource.source,
    cacheStatus,
    preparedAt,
    skillPaths,
    qaReportPath,
    statusPath,
  };
}

async function writeSkillsAudit(
  projectPath: string,
  resource: HyperframesSkillsResource,
  cacheStatus: HyperframesSkillsCacheStatus,
  skillPaths: string[],
  preparedAt: string,
  success: boolean,
  failureReason: string | null,
  blockingIssues: string[],
): Promise<void> {
  const metadata = {
    name: resource.name,
    version: resource.version,
    hash: resource.hash,
    source: resource.source,
    cache_status: cacheStatus,
    cache_root: cacheRootRelativePath,
    skill_paths: skillPaths,
    prepared_at: preparedAt,
    success,
    failure_reason: failureReason,
  };

  await writeJson(path.join(projectPath, statusPath), metadata);
  await writeQaReport(projectPath, qaReportPath, {
    gate_name: "HyperFrames Skills QA",
    status: success ? "rule_pass" : "rule_fail_blocked",
    blocking_issues: blockingIssues,
    input_artifacts: [resource.source],
    output_artifacts: [statusPath, qaReportPath],
    metadata,
  });
}

async function prepareCache(
  projectPath: string,
  resource: HyperframesSkillsResource,
): Promise<HyperframesSkillsCacheStatus> {
  const existingHash = await hashCachedResource(projectPath, resource);
  if (existingHash === resource.hash) return "reused";

  const cacheStatus: HyperframesSkillsCacheStatus = existingHash === null ? "created" : "updated";
  for (const file of resource.files) {
    const targetPath = path.join(projectPath, cacheRootRelativePath, file.relativePath);
    await ensureDir(path.dirname(targetPath));
    await writeFile(targetPath, file.content, "utf8");
  }
  return cacheStatus;
}

async function hashCachedResource(
  projectPath: string,
  resource: HyperframesSkillsResource,
): Promise<string | null> {
  const hashes: string[] = [];
  for (const file of resource.files) {
    try {
      const content = await readFile(path.join(projectPath, cacheRootRelativePath, file.relativePath), "utf8");
      hashes.push(`${file.relativePath}\n${sha256(content)}`);
    } catch {
      return null;
    }
  }
  return sha256(hashes.join("\n"));
}

async function validateSkills(projectPath: string, skillPaths: string[]): Promise<string[]> {
  const blockingIssues: string[] = [];
  for (const relativePath of skillPaths) {
    const text = await readFile(path.join(projectPath, relativePath), "utf8");
    if (!/^---\n[\s\S]*?\n---/m.test(text)) {
      blockingIssues.push(`${relativePath} is missing frontmatter.`);
    }
    if (!/^name:\s*\S+/m.test(text) || !/^description:\s*\S+/m.test(text)) {
      blockingIssues.push(`${relativePath} frontmatter must include name and description.`);
    }
    if (!text.includes("audio/**") || !text.includes("data/timing/**") || !text.includes("dist/**")) {
      blockingIssues.push(`${relativePath} is missing forbidden path rules.`);
    }
    if (/OPENAI_API_KEY|CODEX_API_KEY|auth\.json/i.test(text)) {
      blockingIssues.push(`${relativePath} contains secret-like content.`);
    }
    if (/self[- ]?review content quality|subjective quality/i.test(text)) {
      blockingIssues.push(`${relativePath} asks Codex to self-review subjective content quality.`);
    }
  }
  return blockingIssues;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
