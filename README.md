# VRT Android Utils

One dependency-free CLI creates the same Android Virtual Device locally and in CI. Its sole configuration source is [`emulator.config.json`](./emulator.config.json); the example GitHub workflow calls the same executable used by developers.

## Quick start

Requirements: macOS or Linux, Node.js 20+, JDK 17+, `curl`, and `unzip`.

```sh
./bin/vrt-emulator doctor
./bin/vrt-emulator run -- ./gradlew connectedCheck
```

The second command installs the isolated SDK and Android user state under `.android-sdk`, creates the AVD, boots it, runs the command with `ANDROID_SERIAL` and `EMULATOR_PORT` set, and stops it even when the command fails. Nothing is installed into a developer's global Android SDK.

For iterative local work, keep the emulator alive:

```sh
./bin/vrt-emulator prepare
./bin/vrt-emulator start
./bin/vrt-emulator wait
# Run any local commands here.
./bin/vrt-emulator stop
```

To adjust the emulator, edit `emulator.config.json` and commit the change. A configuration fingerprint forces AVD recreation when image or hardware settings change. `--config path/to/another.json` is available for deliberate experiments without changing the shared default.

## Reproducibility contract

The config pins the emulator binary to version 37.1.11/build 15917651 and requires system-image revision 9. Installation fails if Google's repository serves a different system-image revision; it never silently accepts drift. CI caches `.android-sdk` using the config hash.

The image ABI is necessarily host-specific: Apple Silicon uses `arm64-v8a`, while standard GitHub Linux runners use `x86_64`. An ARM host cannot hardware-accelerate an x86_64 Android image. API level, image revision, Google APIs target, device profile, disk/RAM/CPU settings, port, and Android runtime settings remain identical.

## Commands

```text
validate  validate and resolve the JSON
doctor    report host compatibility and resolved artifacts
install   install pinned SDK artifacts
create    create/reuse the AVD
prepare   install + create
start     launch in the background
wait      wait for sys.boot_completed and apply settings
stop      terminate the emulator
run       full lifecycle around an arbitrary command
config    print the resolved configuration
```

## Design notes from android-emulator-runner

This implementation retains the useful lifecycle from [ReactiveCircus/android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner): install SDK components, create an AVD, launch on an explicit even-numbered port, poll `sys.boot_completed`, normalize animations/spell-checker, run a command, and always terminate. It also retains automatic Linux software acceleration when KVM is unavailable.

Unlike that GitHub-Action-specific implementation, configuration is not duplicated across workflow inputs, SDK installation is isolated, emulator builds and image revisions are checked, arguments are spawned without a shell, AVD reuse is guarded by a fingerprint, and each lifecycle step is directly usable on a developer machine.

The detailed upstream comparison is in [`docs/android-emulator-runner-analysis.md`](./docs/android-emulator-runner-analysis.md).
