import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const CHANNELS = new Map([
  ["stable", 0],
  ["beta", 1],
  ["dev", 2],
  ["canary", 3],
]);
const ARCHES = new Set(["x86", "x86_64", "arm64-v8a"]);
const SIZE = /^[1-9][0-9]*[KMG]$/;

export function hostKey(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === "x64" ? "x64" : arch;
  return `${platform}-${normalizedArch}`;
}

export async function loadConfig(
  configPath = "emulator.config.json",
  cwd = process.cwd(),
  host = hostKey(),
) {
  const absolutePath = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
  let config;
  try {
    config = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read configuration ${absolutePath}: ${error.message}`, {
      cause: error,
    });
  }
  validateConfig(config, host);
  const projectDirectory = dirname(absolutePath);
  const sdkRoot = isAbsolute(config.sdk.directory)
    ? config.sdk.directory
    : resolve(projectDirectory, config.sdk.directory);
  const architecture = config.systemImage.architectureByHost[host];
  const systemImagePackage = `system-images;android-${config.systemImage.apiLevel};${config.systemImage.target};${architecture}`;
  const deviceName = config.avd.device.replace(/[^A-Za-z0-9]/g, "");
  const avd = {
    ...config.avd,
    name: `${config.avd.namePrefix}_api${config.systemImage.apiLevel}_${deviceName}`,
  };
  const resolved = {
    ...config,
    avd,
    configPath: absolutePath,
    projectDirectory,
    sdkRoot,
    host,
    architecture,
    systemImagePackage,
  };
  resolved.fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        emulator: config.emulator,
        systemImagePackage,
        systemImageRevision: config.systemImage.revision,
        avd,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return resolved;
}

export function validateConfig(config, host = hostKey()) {
  const fail = (message) => {
    throw new Error(`Invalid emulator configuration: ${message}`);
  };
  if (!config || typeof config !== "object" || Array.isArray(config))
    fail("root must be an object");
  if (config.schemaVersion !== 1) fail("schemaVersion must be 1");
  for (const section of ["sdk", "emulator", "systemImage", "avd", "launch"]) {
    if (!config[section] || typeof config[section] !== "object") fail(`${section} is required`);
  }
  if (!CHANNELS.has(config.sdk.channel)) fail("sdk.channel must be stable, beta, dev, or canary");
  for (const key of ["directory", "commandLineToolsVersion", "platform", "buildToolsVersion"]) {
    if (typeof config.sdk[key] !== "string" || !config.sdk[key])
      fail(`sdk.${key} must be a non-empty string`);
  }
  if (!/^\d+$/.test(config.emulator.buildId ?? ""))
    fail("emulator.buildId must contain digits only");
  if (!/^\d+\.\d+\.\d+$/.test(config.emulator.version ?? ""))
    fail("emulator.version must be a semantic revision");
  if (
    !config.emulator.archiveSha1ByHost ||
    !/^[a-f0-9]{40}$/.test(config.emulator.archiveSha1ByHost[host] ?? "")
  ) {
    fail(`emulator.archiveSha1ByHost has no valid checksum for ${host}`);
  }
  if (!config.systemImage.architectureByHost || !(host in config.systemImage.architectureByHost)) {
    fail(`systemImage.architectureByHost has no entry for ${host}`);
  }
  if (!ARCHES.has(config.systemImage.architectureByHost[host]))
    fail(`unsupported architecture for ${host}`);
  if (!/^\d+(?:\.\d+){0,2}$/.test(config.systemImage.revision ?? ""))
    fail("systemImage.revision is invalid");
  for (const key of ["apiLevel", "target"])
    if (typeof config.systemImage[key] !== "string" || !config.systemImage[key])
      fail(`systemImage.${key} must be a non-empty string`);
  if (!/^[A-Za-z0-9_.-]+$/.test(config.avd.namePrefix ?? ""))
    fail("avd.namePrefix contains unsafe characters");
  if (typeof config.avd.device !== "string" || !config.avd.device)
    fail("avd.device must be a non-empty string");
  if (!/[A-Za-z0-9]/.test(config.avd.device))
    fail("avd.device must contain at least one letter or digit");
  if (!Number.isInteger(config.avd.cores) || config.avd.cores < 1)
    fail("avd.cores must be a positive integer");
  for (const key of ["ramSize", "heapSize", "diskSize"])
    if (!SIZE.test(config.avd[key] ?? "")) fail(`avd.${key} must be a size such as 2048M`);
  for (const key of ["hardwareKeyboard", "forceRecreate"])
    if (typeof config.avd[key] !== "boolean") fail(`avd.${key} must be boolean`);
  if (
    !Number.isInteger(config.launch.port) ||
    config.launch.port < 5554 ||
    config.launch.port > 5584 ||
    config.launch.port % 2
  )
    fail("launch.port must be even and between 5554 and 5584");
  if (!Number.isInteger(config.launch.bootTimeoutSeconds) || config.launch.bootTimeoutSeconds < 1)
    fail("launch.bootTimeoutSeconds must be positive");
  for (const key of [
    "headless",
    "noSnapshot",
    "noAudio",
    "noBootAnimation",
    "disableAnimations",
    "disableSpellChecker",
  ]) {
    if (typeof config.launch[key] !== "boolean") fail(`launch.${key} must be boolean`);
  }
  if (typeof config.launch.gpu !== "string" || !config.launch.gpu)
    fail("launch.gpu must be a non-empty string");
  if (
    !Array.isArray(config.launch.extraArgs) ||
    config.launch.extraArgs.some((value) => typeof value !== "string")
  )
    fail("launch.extraArgs must be an array of strings");
  return true;
}

export function channelId(channel) {
  return CHANNELS.get(channel);
}
