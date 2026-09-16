import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { loadConfig, validateConfig } from "../src/config.mjs";

test("checked-in configuration resolves host-specific ABI", async () => {
  const config = await loadConfig("emulator.config.json", process.cwd(), "darwin-arm64");
  expect(config.architecture).toBe("arm64-v8a");
  expect(config.systemImagePackage).toBe("system-images;android-35;google_apis;arm64-v8a");
  expect(config.fingerprint).toMatch(/^[a-f0-9]{16}$/);
});

test("standard Linux CI resolves x86_64 ABI", async () => {
  const config = await loadConfig("emulator.config.json", process.cwd(), "linux-x64");
  expect(config.architecture).toBe("x86_64");
});

test("published example matches the repository configuration", async () => {
  const repositoryConfig = JSON.parse(await readFile("emulator.config.json", "utf8"));
  const publishedExample = JSON.parse(await readFile("emulator.config.example.json", "utf8"));

  delete repositoryConfig.$schema;
  delete publishedExample.$schema;
  expect(publishedExample).toEqual(repositoryConfig);
});

test("unknown hosts fail instead of silently choosing a different image", async () => {
  await expect(loadConfig("emulator.config.json", process.cwd(), "win32-x64")).rejects.toThrow(
    /no valid checksum|no entry/,
  );
});

test("odd emulator ports are rejected", () => {
  const minimal = {
    schemaVersion: 1,
    sdk: {
      directory: ".sdk",
      commandLineToolsVersion: "1",
      channel: "stable",
      platform: "35",
      buildToolsVersion: "35.0.0",
    },
    emulator: {
      version: "1.2.3",
      buildId: "123",
      archiveSha1ByHost: { "linux-x64": "a".repeat(40) },
    },
    systemImage: {
      apiLevel: "35",
      target: "google_apis",
      revision: "1",
      architectureByHost: { "linux-x64": "x86_64" },
    },
    avd: {
      name: "test",
      device: "pixel_7",
      cores: 2,
      ramSize: "2G",
      heapSize: "512M",
      diskSize: "6G",
      hardwareKeyboard: true,
      forceRecreate: false,
    },
    launch: {
      port: 5555,
      bootTimeoutSeconds: 1,
      headless: true,
      gpu: "auto",
      noSnapshot: true,
      noAudio: true,
      noBootAnimation: true,
      disableAnimations: true,
      disableSpellChecker: true,
      extraArgs: [],
    },
  };
  expect(() => validateConfig(minimal, "linux-x64")).toThrow(/launch.port/);
});
