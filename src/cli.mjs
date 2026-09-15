#!/usr/bin/env bun
import { loadConfig } from "./config.mjs";
import {
  createAvd,
  doctor,
  install,
  openVisible,
  runWithEmulator,
  start,
  stop,
  waitForBoot,
} from "./emulator.mjs";

function usage() {
  console.log(`Usage: vrt-emulator [--config FILE] COMMAND [-- COMMAND_ARGS...]

Commands:
  validate       Validate and resolve the JSON configuration
  doctor         Check the host and print the resolved emulator
  install        Install the pinned SDK packages and emulator
  create         Create or reuse the configured AVD
  prepare        Install packages and create the AVD
  start          Start the AVD in the background
  open           Prepare and open a visible local emulator window
  wait           Wait until Android has completed booting
  stop           Stop the configured emulator
  run -- CMD...  Prepare, start, run CMD, and always stop
  config         Print the fully resolved configuration`);
}

async function main(argv) {
  let configPath = "emulator.config.json";
  if (argv[0] === "--config") {
    if (!argv[1]) throw new Error("--config requires a file path");
    configPath = argv[1];
    argv = argv.slice(2);
  }
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const config = await loadConfig(configPath);
  switch (command) {
    case "validate":
      console.log(
        `Valid configuration: ${config.configPath}\nHost: ${config.host}\nSystem image: ${config.systemImagePackage}\nFingerprint: ${config.fingerprint}`,
      );
      break;
    case "config":
      console.log(JSON.stringify(config, null, 2));
      break;
    case "doctor":
      await doctor(config);
      break;
    case "install":
      await install(config);
      break;
    case "create":
      await createAvd(config);
      break;
    case "prepare":
      await install(config);
      await createAvd(config);
      break;
    case "start":
      await start(config);
      break;
    case "open":
      await openVisible(config);
      break;
    case "wait":
      await waitForBoot(config);
      break;
    case "stop":
      await stop(config);
      break;
    case "run": {
      const separator = argv.indexOf("--");
      await runWithEmulator(config, separator >= 0 ? argv.slice(separator + 1) : argv.slice(1));
      break;
    }
    default:
      throw new Error(`Unknown command '${command}'. Run with --help.`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`vrt-emulator: ${error.message}`);
  process.exitCode = 1;
});
