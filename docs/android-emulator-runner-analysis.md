# android-emulator-runner analysis

Analyzed upstream commit [`ed009f5`](https://github.com/ReactiveCircus/android-emulator-runner/commit/ed009f5318f15b1cf93a191b856c4f1748a2d4c1) (2026-08-26).

## Upstream lifecycle

1. Read and validate GitHub Action inputs.
2. Detect Linux KVM access and choose hardware or software acceleration.
3. Install command-line tools, SDK platform/build tools, emulator, and a system image.
4. Create an AVD and append hardware properties to `config.ini`.
5. Start the emulator on a fixed port and poll `sys.boot_completed` every two seconds.
6. Unlock the device, disable sources of test flakiness, run the requested shell script, and kill the emulator.

Its strongest ideas are explicit package construction (`system-images;android-<api>;<target>;<abi>`), an even emulator port with a matching `ANDROID_SERIAL`, boot-property polling instead of a fixed sleep, KVM auto-detection, and cleanup around the test command.

## Gaps addressed here

| Concern | Upstream action | This library |
| --- | --- | --- |
| Configuration | GitHub Action inputs, commonly duplicated in YAML | One checked-in JSON used unchanged by CLI and CI |
| Local use | Coupled to `@actions/*` runtime | Dependency-free Bun CLI |
| Emulator version | Latest by default; optional build override | Required version and build ID |
| System-image drift | Latest matching package is accepted | Installed revision must equal the JSON revision |
| SDK location | Uses the runner/developer `ANDROID_HOME` | Project-isolated `.android-sdk` |
| AVD reuse | Existence or force flag | Configuration fingerprint |
| Command execution | User script is parsed and passed to a shell | Argument array is spawned without a shell |
| CI coupling | Executes test script inside the action | Same lifecycle command runs locally and in any CI |

## Constraint: host ABI

Byte-identical Android system-image archives cannot be accelerated on both Apple Silicon and x86_64 Linux. The configuration therefore maps only the ABI by host and deliberately rejects unknown hosts. Both mapped archives represent API 35, Google APIs target, revision 9; all AVD hardware and runtime settings are shared.
