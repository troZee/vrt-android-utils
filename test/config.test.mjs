import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.mjs';

test('checked-in configuration resolves host-specific ABI', async () => {
  const config = await loadConfig('emulator.config.json', process.cwd(), 'darwin-arm64');
  assert.equal(config.architecture, 'arm64-v8a');
  assert.equal(config.systemImagePackage, 'system-images;android-35;google_apis;arm64-v8a');
  assert.match(config.fingerprint, /^[a-f0-9]{16}$/);
});

test('standard Linux CI resolves x86_64 ABI', async () => {
  const config = await loadConfig('emulator.config.json', process.cwd(), 'linux-x64');
  assert.equal(config.architecture, 'x86_64');
});

test('unknown hosts fail instead of silently choosing a different image', async () => {
  await assert.rejects(loadConfig('emulator.config.json', process.cwd(), 'win32-x64'), /no valid checksum|no entry/);
});

test('odd emulator ports are rejected', () => {
  const minimal = {
    schemaVersion: 1,
    sdk: { directory: '.sdk', commandLineToolsVersion: '1', channel: 'stable', platform: '35', buildToolsVersion: '35.0.0' },
    emulator: { version: '1.2.3', buildId: '123', archiveSha1ByHost: { 'linux-x64': 'a'.repeat(40) } },
    systemImage: { apiLevel: '35', target: 'google_apis', revision: '1', architectureByHost: { 'linux-x64': 'x86_64' } },
    avd: { name: 'test', device: 'pixel_7', cores: 2, ramSize: '2G', heapSize: '512M', diskSize: '6G', hardwareKeyboard: true, forceRecreate: false },
    launch: { port: 5555, bootTimeoutSeconds: 1, headless: true, gpu: 'auto', noSnapshot: true, noAudio: true, noBootAnimation: true, disableAnimations: true, disableSpellChecker: true, extraArgs: [] }
  };
  assert.throws(() => validateConfig(minimal, 'linux-x64'), /launch.port/);
});
