# VRT Android Utils

`vrt-android-utils` is a dependency-free CLI for creating the same pinned Android Virtual Device on developer machines and in CI. A project-owned `emulator.config.json` is the single source of truth for the SDK, emulator build, system image, device profile, resources, port, and launch settings.

The CLI installs an isolated Android SDK and AVD under the configured directory. It does not modify a developer's global Android SDK.

## Requirements

- Node.js 20 or newer
- macOS on Apple Silicon or x64, or Linux on x64
- JDK 17 or newer with `JAVA_HOME` set
- `curl` and `unzip`
- KVM access on Linux for hardware acceleration; the CLI falls back to software acceleration when KVM is unavailable

Windows and Linux ARM64 are not currently supported.

## Install

Install the CLI as a development dependency so that local development and CI use the same version:

```sh
npm install --save-dev vrt-android-utils
```

```sh
yarn add --dev vrt-android-utils
```

```sh
pnpm add --save-dev vrt-android-utils
```

```sh
bun add --dev vrt-android-utils
```

Do not install it globally. Invoke the project-local binary with `npx vrt-emulator`, `yarn vrt-emulator`, `pnpm exec vrt-emulator`, or `bunx vrt-emulator`. The CLI itself runs on Node regardless of which package manager installs it; consumers do not need Bun.

## Configure

Create `emulator.config.json` in the project root. Start from [`emulator.config.example.json`](https://github.com/troZee/vrt-android-utils/blob/main/emulator.config.example.json) and commit the resulting file:

```sh
curl --fail --location \
  https://unpkg.com/vrt-android-utils/emulator.config.example.json \
  --output emulator.config.json
```

Edit the copy deliberately for the consuming project. In particular, review:

- `sdk.platform` and `sdk.buildToolsVersion`
- `emulator.version`, `emulator.buildId`, and every host archive checksum
- `systemImage.apiLevel`, `systemImage.target`, revision, and host architectures
- `avd.namePrefix`, device, CPU, memory, and disk settings
- `launch.port`, timeout, GPU mode, and headless behavior

The CLI derives the AVD name from `avd.namePrefix`, the API level, and the device profile. For example, prefix `my_prefix`, API 36, and device `pixel_9` produce `my_prefix_api36_pixel9`. The host-specific ABI is deliberately omitted so macOS and Linux use the same logical AVD name.

Relative paths such as `sdk.directory` are resolved relative to the configuration file, not the shell's working directory. The default `.android-sdk` directory should be added to the consuming project's `.gitignore`.

Validate the configuration before downloading anything:

```sh
npx vrt-emulator validate
npx vrt-emulator doctor
```

Use `--config` when the file has another name or location:

```sh
npx vrt-emulator --config config/android-emulator.json validate
```

## Run a command in the emulator lifecycle

The normal CI entry point prepares the SDK and AVD, boots Android, waits until it is ready, runs the requested command with `ANDROID_SERIAL` and `EMULATOR_PORT` set, and stops the emulator even if that command fails:

```sh
npx vrt-emulator run -- ./scripts/run-android-vrt.sh
```

The command is started directly, without a shell. Put pipelines, redirections, environment assignments, or multiple commands in a checked-in wrapper script and pass that script to `run`.

For a Yarn project, a package script can make the command easier to discover:

```json
{
  "scripts": {
    "vrt:android:emulator": "vrt-emulator run -- ./scripts/run-android-vrt.sh"
  }
}
```

Then run:

```sh
yarn vrt:android:emulator
```

## Local development

Open a graphical emulator and leave it running:

```sh
npx vrt-emulator open
# Use the emulator, then close it with:
npx vrt-emulator stop
```

`open` changes only the window behavior. All API, image, emulator build, device, resource, and Android runtime settings still come from the configuration.

For an iterative session:

```sh
npx vrt-emulator prepare
npx vrt-emulator start
npx vrt-emulator wait
# Run local commands here.
npx vrt-emulator stop
```

## Commands

```text
validate  validate and resolve the JSON configuration
doctor    report host compatibility and resolved artifacts
install   install pinned SDK artifacts
create    create or reuse the configured AVD
prepare   install artifacts and create the AVD
start     launch the emulator in the background
open      prepare and launch a visible emulator, then wait until ready
wait      wait for sys.boot_completed and apply runtime settings
stop      terminate the configured emulator
run       manage the full lifecycle around an arbitrary command
config    print the fully resolved configuration
```

Run `npx vrt-emulator --help` for CLI syntax.

## GitHub Actions example

The package works as a regular CLI; it does not require a custom GitHub Action:

```yaml
name: Android visual tests

on:
  pull_request:

permissions:
  contents: read

jobs:
  visual-test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - run: yarn install --immutable

      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm

      - name: Cache pinned SDK and AVD
        uses: actions/cache@v4
        with:
          path: .android-sdk
          key: android-emulator-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('emulator.config.json') }}

      - name: Validate emulator configuration
        run: yarn vrt-emulator validate

      - name: Run visual tests
        run: yarn vrt-emulator run -- ./scripts/run-android-vrt.sh
```

Ubuntu GitHub-hosted runners normally include `curl` and `unzip`. Install them before invoking the CLI if using a smaller custom runner image.

## Reproducibility guarantees

The example configuration pins the emulator binary version and build, its archive checksum for every supported host, and the system-image revision. Installation fails if Google's repository serves a different emulator archive or system-image revision; drift is never silently accepted.

The system-image ABI is necessarily host-specific: Apple Silicon uses `arm64-v8a`, while macOS x64 and standard GitHub Linux runners use `x86_64`. API level, image revision, target, device profile, disk, RAM, CPUs, port, and Android runtime settings can remain identical.

An AVD fingerprint is derived from the relevant configuration. The CLI recreates the AVD when those settings change and reuses it otherwise.

## Design

The lifecycle is based on the useful parts of [`ReactiveCircus/android-emulator-runner`](https://github.com/ReactiveCircus/android-emulator-runner): installing SDK components, creating an AVD, launching on an explicit port, waiting for `sys.boot_completed`, normalizing runtime settings, running a command, and always stopping the emulator.

Unlike a GitHub-Action-specific integration, this CLI uses the same project-owned configuration and executable locally and in CI. SDK installation is isolated, emulator builds and image revisions are verified, commands are spawned without a shell, and AVD reuse is guarded by a configuration fingerprint. See [the detailed design analysis](https://github.com/troZee/vrt-android-utils/blob/main/docs/android-emulator-runner-analysis.md).

This repository's [Android emulator workflow](https://github.com/troZee/vrt-android-utils/blob/main/.github/workflows/android-emulator.yml) is a complete integration example, including KVM setup, SDK/AVD caching, and synchronous APK installation.

## Development

This repository uses Bun for development tasks, but Bun is not required by package consumers:

```sh
bun install --frozen-lockfile
bun run check
```

`bun run check` runs formatting, linting, tests, a Node-runtime CLI test, and a dry-run package inspection. The npm package uses a strict `files` allowlist; no `.npmignore` is required. The package check fails if an unexpected file would be published.

See [the release guide](https://github.com/troZee/vrt-android-utils/blob/main/RELEASING.md) for the release procedure.

## License

MIT
