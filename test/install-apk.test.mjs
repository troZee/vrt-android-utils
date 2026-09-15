import { afterEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function runInstaller(adbOutput, adbStatus = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'anyapk-test-'));
  temporaryDirectories.push(directory);
  const adb = join(directory, 'adb');
  const apk = join(directory, 'application.apk');
  await writeFile(adb, `#!/bin/sh\nprintf '%s\\n' '${adbOutput}'\nexit ${adbStatus}\n`);
  await chmod(adb, 0o755);
  await writeFile(apk, 'fixture');
  return Bun.spawnSync(['bash', resolve('scripts/install-apk-and-wait.sh'), apk], {
    env: { ...process.env, ANDROID_SERIAL: 'emulator-5554', PATH: `${directory}:${process.env.PATH}` },
    stdout: 'pipe',
    stderr: 'pipe'
  });
}

test('APK installer waits for and accepts adb Success', async () => {
  const result = await runInstaller('Success');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('installation completed successfully');
});

test('APK installer rejects output without terminal Success', async () => {
  const result = await runInstaller('Failure [INSTALL_FAILED_INVALID_APK]', 1);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain('did not finish with Success');
});
