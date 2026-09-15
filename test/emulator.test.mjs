import { expect, test } from "bun:test";
import { commandLineToolsArchive } from "../src/emulator.mjs";

const config = (host) => ({
  host,
  sdk: { commandLineToolsVersion: "15859902" },
});

test("uses Google's Linux command-line tools archive name", () => {
  expect(commandLineToolsArchive(config("linux-x64"))).toBe(
    "https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip",
  );
});

test("uses architecture-specific macOS command-line tools archive names", () => {
  expect(commandLineToolsArchive(config("darwin-x64"))).toContain(
    "commandlinetools-mac_x86_64-15859902_latest.zip",
  );
  expect(commandLineToolsArchive(config("darwin-arm64"))).toContain(
    "commandlinetools-mac_arm64-15859902_latest.zip",
  );
});

test("rejects hosts without a command-line tools archive", () => {
  expect(() => commandLineToolsArchive(config("linux-arm64"))).toThrow(
    /No pinned command-line tools support host linux-arm64/,
  );
});
