import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { toWslPath } from "../src/lib/wsl-path.ts";

test("toWslPath returns a real absolute path on non-Windows platforms", async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), "qivance-wsl-path-linux-"));
  await mkdir(path.join(projectPath, "nested"));

  assert.equal(
    await toWslPath({ absolutePath: path.join(projectPath, "nested"), platform: "linux" }),
    await realpath(path.join(projectPath, "nested")),
  );
});

test("toWslPath uses wslpath for Windows paths with spaces", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "qivance-wsl-path-win-"));
  const fakeWsl = path.join(tempRoot, "wsl.exe");
  await writeFile(fakeWsl, [
    "#!/usr/bin/env bash",
    "script=\"${@: -1}\"",
    "if [[ \"$script\" == *\"wslpath -a\"* ]]; then",
    "  echo '/mnt/c/Users/Jym/My Project'",
    "  exit 0",
    "fi",
    "exit 1",
    "",
  ].join("\n"));
  await chmod(fakeWsl, 0o755);

  assert.equal(
    await toWslPath({
      absolutePath: "C:\\Users\\Jym\\My Project",
      platform: "win32",
      wslExe: fakeWsl,
    }),
    "/mnt/c/Users/Jym/My Project",
  );
});
