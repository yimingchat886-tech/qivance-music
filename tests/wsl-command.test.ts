import assert from "node:assert/strict";
import test from "node:test";
import { resolveWslExe } from "../src/lib/wsl-command.ts";

test("resolveWslExe prefers the Windows System32 WSL executable from WSL when PATH omits wsl.exe", () => {
  assert.equal(
    resolveWslExe({
      env: { WSL_DISTRO_NAME: "Ubuntu", PATH: "/usr/bin:/bin" },
      platform: "linux",
      existsSync: (candidate) => candidate === "/mnt/c/Windows/System32/wsl.exe",
    }),
    "/mnt/c/Windows/System32/wsl.exe",
  );
});

test("resolveWslExe keeps explicit QIVANCE_WSL_EXE overrides", () => {
  assert.equal(
    resolveWslExe({
      env: { QIVANCE_WSL_EXE: "/custom/wsl.exe" },
      platform: "linux",
      existsSync: () => false,
    }),
    "/custom/wsl.exe",
  );
});
