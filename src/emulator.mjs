import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { access, appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { capture, run } from "./process.mjs";
import { channelId } from "./config.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paths(config) {
  const avdHome = join(config.sdkRoot, "avd");
  return {
    sdkmanager: join(config.sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager"),
    avdmanager: join(config.sdkRoot, "cmdline-tools", "latest", "bin", "avdmanager"),
    emulator: join(config.sdkRoot, "emulator", "emulator"),
    adb: join(config.sdkRoot, "platform-tools", "adb"),
    avdHome,
    avdDirectory: join(avdHome, `${config.avd.name}.avd`),
    fingerprint: join(avdHome, `${config.avd.name}.avd`, ".vrt-config-fingerprint"),
    pid: join(avdHome, `${config.avd.name}.pid`),
    log: join(avdHome, `${config.avd.name}.log`),
  };
}

function sdkEnv(config) {
  const p = paths(config);
  return {
    ...process.env,
    ANDROID_HOME: config.sdkRoot,
    ANDROID_SDK_ROOT: config.sdkRoot,
    ANDROID_USER_HOME: join(config.sdkRoot, "user-home"),
    ANDROID_AVD_HOME: p.avdHome,
    PATH: [
      join(config.sdkRoot, "cmdline-tools", "latest", "bin"),
      join(config.sdkRoot, "platform-tools"),
      join(config.sdkRoot, "emulator"),
      process.env.PATH ?? "",
    ].join(delimiter),
  };
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canUseKvm() {
  try {
    await access("/dev/kvm", constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function emulatorArchive(config) {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  if (!os)
    throw new Error(`Unsupported host ${process.platform}; only macOS and Linux are supported`);
  const cpu = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x64" : null;
  if (!cpu) throw new Error(`Unsupported host CPU ${process.arch}`);
  return `https://dl.google.com/android/repository/emulator-${os}_${cpu}-${config.emulator.buildId}.zip`;
}

export function commandLineToolsArchive(config) {
  const platform = {
    "darwin-arm64": "mac_arm64",
    "darwin-x64": "mac_x86_64",
    "linux-x64": "linux",
  }[config.host];
  if (!platform) throw new Error(`No pinned command-line tools support host ${config.host}`);
  return `https://dl.google.com/android/repository/commandlinetools-${platform}-${config.sdk.commandLineToolsVersion}_latest.zip`;
}

function expectedEmulatorHostDirectory(config) {
  const directories = {
    "darwin-arm64": "darwin-aarch64",
    "darwin-x64": "darwin-x86_64",
    "linux-x64": "linux-x86_64",
  };
  const directory = directories[config.host];
  if (!directory) throw new Error(`No pinned emulator binary supports host ${config.host}`);
  return join(config.sdkRoot, "emulator", "qemu", directory);
}

async function sha1(path) {
  const hash = createHash("sha1");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function installCommandLineTools(config) {
  const p = paths(config);
  if (await exists(p.sdkmanager)) return;
  const temporary = await mkdtemp(join(tmpdir(), "vrt-command-line-tools-"));
  try {
    const archive = join(temporary, "tools.zip");
    const url = commandLineToolsArchive(config);
    await run("curl", ["--fail", "--location", "--retry", "3", "--output", archive, url]);
    const staging = join(temporary, "unpacked");
    await mkdir(staging, { recursive: true });
    await run("unzip", ["-q", archive, "-d", staging]);
    await mkdir(join(config.sdkRoot, "cmdline-tools"), { recursive: true });
    await rm(join(config.sdkRoot, "cmdline-tools", "latest"), { recursive: true, force: true });
    await run("mv", [
      join(staging, "cmdline-tools"),
      join(config.sdkRoot, "cmdline-tools", "latest"),
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function property(path, key) {
  const content = await readFile(path, "utf8");
  return content
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();
}

async function ensureEmulatorPackageMetadata(config, preservedMetadata) {
  const packageXml = join(config.sdkRoot, "emulator", "package.xml");
  if (await exists(packageXml)) return;
  if (preservedMetadata) {
    await writeFile(packageXml, preservedMetadata);
    return;
  }
  const [major, minor, micro] = config.emulator.version.split(".");
  await writeFile(
    packageXml,
    `<?xml version="1.0" encoding="UTF-8"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:ns5="http://schemas.android.com/repository/android/generic/02">
  <localPackage path="emulator" obsolete="false">
    <type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns5:genericDetailsType" />
    <revision><major>${major}</major><minor>${minor}</minor><micro>${micro}</micro></revision>
    <display-name>Android Emulator</display-name>
  </localPackage>
</ns2:repository>
`,
  );
}

async function installPinnedEmulator(config) {
  const sourceProperties = join(config.sdkRoot, "emulator", "source.properties");
  let preservedMetadata;
  if (await exists(sourceProperties)) {
    const version = await property(sourceProperties, "Pkg.Revision");
    const build = await property(sourceProperties, "Pkg.BuildId");
    const correctHostBinary = await exists(expectedEmulatorHostDirectory(config));
    if (
      version === config.emulator.version &&
      build?.split("/")[0] === config.emulator.buildId &&
      correctHostBinary
    ) {
      await ensureEmulatorPackageMetadata(config);
      return;
    }
    if (!correctHostBinary)
      console.warn(
        `Installed emulator binary does not match host ${config.host}; reinstalling the pinned host artifact.`,
      );
    try {
      preservedMetadata = await readFile(join(config.sdkRoot, "emulator", "package.xml"), "utf8");
    } catch {}
    await rm(join(config.sdkRoot, "emulator"), { recursive: true, force: true });
  }
  const temporary = await mkdtemp(join(tmpdir(), "vrt-emulator-"));
  try {
    const archive = join(temporary, "emulator.zip");
    await run("curl", [
      "--fail",
      "--location",
      "--retry",
      "3",
      "--output",
      archive,
      emulatorArchive(config),
    ]);
    const actualSha1 = await sha1(archive);
    const expectedSha1 = config.emulator.archiveSha1ByHost[config.host];
    if (actualSha1 !== expectedSha1)
      throw new Error(
        `Emulator archive checksum mismatch: received ${actualSha1}, expected ${expectedSha1}`,
      );
    await run("unzip", ["-q", archive, "-d", config.sdkRoot]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const actual = await property(sourceProperties, "Pkg.Revision");
  if (actual !== config.emulator.version)
    throw new Error(
      `Pinned emulator build resolved to ${actual}, expected ${config.emulator.version}`,
    );
  await ensureEmulatorPackageMetadata(config, preservedMetadata);
}

async function installationMatches(config) {
  const p = paths(config);
  const imageProperties = join(
    config.sdkRoot,
    "system-images",
    `android-${config.systemImage.apiLevel}`,
    config.systemImage.target,
    config.architecture,
    "source.properties",
  );
  try {
    return (
      (await exists(p.sdkmanager)) &&
      (await exists(p.avdmanager)) &&
      (await exists(p.adb)) &&
      (await exists(expectedEmulatorHostDirectory(config))) &&
      (await property(join(config.sdkRoot, "emulator", "source.properties"), "Pkg.Revision")) ===
        config.emulator.version &&
      (await property(join(config.sdkRoot, "emulator", "source.properties"), "Pkg.BuildId"))?.split(
        "/",
      )[0] === config.emulator.buildId &&
      (await property(imageProperties, "Pkg.Revision")) === config.systemImage.revision
    );
  } catch {
    return false;
  }
}

export async function ensureInstalled(config) {
  if (await installationMatches(config)) {
    await ensureEmulatorPackageMetadata(config);
    console.log(
      `Reusing installed SDK and native ${config.host} emulator ${config.emulator.version} (${config.emulator.buildId}).`,
    );
    return;
  }
  await install(config);
}

export async function install(config) {
  await mkdir(config.sdkRoot, { recursive: true });
  await mkdir(join(config.sdkRoot, "user-home"), { recursive: true });
  await installCommandLineTools(config);
  const p = paths(config);
  const env = sdkEnv(config);
  await run(p.sdkmanager, ["--licenses"], {
    env,
    input: "y\n".repeat(100),
    stdio: ["pipe", "inherit", "inherit"],
  }).catch((error) => {
    throw new Error(
      `Android licenses were not accepted. Run '${p.sdkmanager} --licenses' interactively. ${error.message}`,
    );
  });
  await run(
    p.sdkmanager,
    [
      "--install",
      `--channel=${channelId(config.sdk.channel)}`,
      `platform-tools`,
      `platforms;android-${config.sdk.platform}`,
      `build-tools;${config.sdk.buildToolsVersion}`,
      config.systemImagePackage,
    ],
    { env },
  );
  await installPinnedEmulator(config);
  const imageProperties = join(
    config.sdkRoot,
    "system-images",
    `android-${config.systemImage.apiLevel}`,
    config.systemImage.target,
    config.architecture,
    "source.properties",
  );
  const actualRevision = await property(imageProperties, "Pkg.Revision");
  if (actualRevision !== config.systemImage.revision) {
    throw new Error(
      `System image revision drift: installed ${actualRevision}, config requires ${config.systemImage.revision}. Update emulator.config.json deliberately or restore the pinned SDK cache.`,
    );
  }
  console.log(
    `Installed ${config.systemImagePackage} revision ${actualRevision} and emulator ${config.emulator.version} (${config.emulator.buildId}).`,
  );
}

export async function createAvd(config) {
  const p = paths(config);
  const env = sdkEnv(config);
  if (!(await exists(p.avdmanager))) throw new Error("SDK tools are missing; run install first");
  await ensureEmulatorPackageMetadata(config);
  let currentFingerprint;
  try {
    currentFingerprint = (await readFile(p.fingerprint, "utf8")).trim();
  } catch {}
  const recreate = config.avd.forceRecreate || currentFingerprint !== config.fingerprint;
  if (!recreate && (await exists(p.avdDirectory))) {
    console.log(`Reusing AVD ${config.avd.name} (${config.fingerprint}).`);
    return;
  }
  await rm(p.avdDirectory, { recursive: true, force: true });
  await rm(join(p.avdHome, `${config.avd.name}.ini`), { force: true });
  await mkdir(p.avdHome, { recursive: true });
  await run(
    p.avdmanager,
    [
      "create",
      "avd",
      "--force",
      "--name",
      config.avd.name,
      "--package",
      config.systemImagePackage,
      "--device",
      config.avd.device,
    ],
    {
      env,
      input: "no\n",
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  await appendFile(
    join(p.avdDirectory, "config.ini"),
    [
      `hw.cpu.ncore=${config.avd.cores}`,
      `hw.ramSize=${config.avd.ramSize}`,
      `hw.heapSize=${config.avd.heapSize}`,
      `disk.dataPartition.size=${config.avd.diskSize}`,
      `hw.keyboard=${config.avd.hardwareKeyboard ? "yes" : "no"}`,
      "",
    ].join("\n"),
  );
  await writeFile(p.fingerprint, `${config.fingerprint}\n`);
  console.log(`Created AVD ${config.avd.name} (${config.fingerprint}).`);
}

function serial(config) {
  return `emulator-${config.launch.port}`;
}

async function adb(config, args, options = {}) {
  return run(paths(config).adb, ["-s", serial(config), ...args], {
    env: sdkEnv(config),
    ...options,
  });
}

export async function start(config, { visible = false } = {}) {
  const p = paths(config);
  if (!(await exists(p.avdDirectory))) throw new Error("AVD is missing; run create first");
  if (!(await exists(p.emulator)))
    throw new Error("Pinned emulator binary is missing; run install first");
  try {
    const result = await capture(p.adb, ["-s", serial(config), "get-state"], {
      env: sdkEnv(config),
    });
    if (result.stdout.trim() === "device") throw new Error(`${serial(config)} is already running`);
  } catch (error) {
    if (error.message.includes("already running")) throw error;
  }
  const args = [
    "-port",
    String(config.launch.port),
    "-avd",
    config.avd.name,
    "-gpu",
    config.launch.gpu,
  ];
  if (config.launch.headless && !visible) args.push("-no-window");
  if (config.launch.noSnapshot) args.push("-no-snapshot");
  if (config.launch.noAudio) args.push("-noaudio");
  if (config.launch.noBootAnimation) args.push("-no-boot-anim");
  if (process.platform === "linux" && !(await canUseKvm())) args.push("-accel", "off");
  args.push(...config.launch.extraArgs);
  await mkdir(p.avdHome, { recursive: true });
  const log = await open(p.log, "w");
  const child = spawn(p.emulator, args, {
    env: sdkEnv(config),
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  await sleep(750);
  if (child.exitCode !== null) {
    await log.close();
    const tail = (await readFile(p.log, "utf8")).split(/\r?\n/).slice(-30).join("\n");
    throw new Error(`Emulator exited during launch with code ${child.exitCode}.\n${tail}`);
  }
  await writeFile(p.pid, `${child.pid}\n`);
  await log.close();
  console.log(
    `Started ${config.avd.name} as ${serial(config)} (PID ${child.pid}, ${visible ? "visible window" : "background"}); log: ${p.log}`,
  );
}

export async function openVisible(config) {
  await ensureInstalled(config);
  await createAvd(config);
  await start(config, { visible: true });
  try {
    await waitForBoot(config);
  } catch (error) {
    await stop(config);
    throw error;
  }
  console.log(`The ${config.avd.name} window is open. Run 'vrt-emulator stop' when finished.`);
}

export async function waitForBoot(config) {
  const deadline = Date.now() + config.launch.bootTimeoutSeconds * 1000;
  const p = paths(config);
  while (Date.now() < deadline) {
    try {
      const pid = Number.parseInt((await readFile(p.pid, "utf8")).trim(), 10);
      process.kill(pid, 0);
    } catch {
      let tail = "";
      try {
        tail = (await readFile(p.log, "utf8")).split(/\r?\n/).slice(-30).join("\n");
      } catch {}
      throw new Error(
        `Emulator exited before Android completed booting.${tail ? `\nEmulator log tail:\n${tail}` : ""}`,
      );
    }
    try {
      const result = await capture(
        p.adb,
        ["-s", serial(config), "shell", "getprop", "sys.boot_completed"],
        { env: sdkEnv(config) },
      );
      if (result.stdout.trim() === "1") {
        await adb(config, ["shell", "input", "keyevent", "82"]);
        if (config.launch.disableAnimations) {
          for (const setting of [
            "window_animation_scale",
            "transition_animation_scale",
            "animator_duration_scale",
          ]) {
            await adb(config, ["shell", "settings", "put", "global", setting, "0.0"]);
          }
        }
        if (config.launch.disableSpellChecker)
          await adb(config, ["shell", "settings", "put", "secure", "spell_checker_enabled", "0"]);
        console.log(`${serial(config)} is booted and ready.`);
        return;
      }
    } catch {}
    await sleep(2000);
  }
  let tail = "";
  try {
    tail = (await readFile(p.log, "utf8")).split(/\r?\n/).slice(-30).join("\n");
  } catch {}
  throw new Error(
    `Timed out after ${config.launch.bootTimeoutSeconds}s waiting for ${serial(config)}.${tail ? `\nEmulator log tail:\n${tail}` : ""}`,
  );
}

export async function stop(config) {
  const p = paths(config);
  let adbStopped = false;
  try {
    await adb(config, ["emu", "kill"]);
    adbStopped = true;
  } catch (error) {
    console.warn(`Could not stop ${serial(config)} through adb: ${error.message}`);
  }
  if (!adbStopped) {
    try {
      const pid = Number.parseInt((await readFile(p.pid, "utf8")).trim(), 10);
      const processInfo = await capture("ps", ["-p", String(pid), "-o", "command="]);
      if (Number.isInteger(pid) && processInfo.stdout.includes(p.emulator)) {
        process.kill(pid, "SIGTERM");
        console.log(`Stopped emulator process PID ${pid}.`);
      }
    } catch {}
  }
  await rm(p.pid, { force: true });
}

export async function runWithEmulator(config, command) {
  if (!command.length) throw new Error("run requires a command after --");
  await ensureInstalled(config);
  await createAvd(config);
  let started = false;
  let stopping = false;
  const onSignal = async (signal) => {
    if (stopping) return;
    stopping = true;
    if (started) await stop(config);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  const onSigint = () => {
    void onSignal("SIGINT");
  };
  const onSigterm = () => {
    void onSignal("SIGTERM");
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    await start(config);
    started = true;
    await waitForBoot(config);
    await run(command[0], command.slice(1), {
      cwd: config.projectDirectory,
      env: {
        ...sdkEnv(config),
        ANDROID_SERIAL: serial(config),
        EMULATOR_PORT: String(config.launch.port),
      },
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    if (started && !stopping) await stop(config);
  }
}

export async function doctor(config) {
  const checks = [
    ["Java", process.env.JAVA_HOME ? `JAVA_HOME=${process.env.JAVA_HOME}` : "JAVA_HOME is not set"],
    ["Host", config.host],
    ["SDK", config.sdkRoot],
    ["System image", `${config.systemImagePackage} revision ${config.systemImage.revision}`],
    ["Emulator", `${config.emulator.version} build ${config.emulator.buildId}`],
    [
      "Acceleration",
      process.platform === "linux"
        ? (await canUseKvm())
          ? "/dev/kvm is readable and writable"
          : "KVM unavailable; software acceleration will be used"
        : "Hypervisor.Framework (managed by emulator)",
    ],
  ];
  for (const [name, value] of checks) console.log(`${name}: ${value}`);
  if (!process.env.JAVA_HOME)
    throw new Error("JAVA_HOME must point to a supported JDK (17 or newer recommended)");
}
