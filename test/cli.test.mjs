import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("published CLI runs with Node", () => {
  const result = spawnSync(process.execPath, [resolve("src/cli.mjs"), "--help"], {
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Usage: vrt-emulator");
  expect(result.stderr).toBe("");
});
