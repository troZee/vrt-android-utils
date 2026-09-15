import test from 'node:test';
import assert from 'node:assert/strict';
import { capture } from '../src/process.mjs';

test('process helper can answer interactive tools without a shell', async () => {
  const result = await capture(process.execPath, ['-e', "process.stdin.once('data', d => process.stdout.write(d))"], { input: 'yes\n' });
  assert.equal(result.stdout, 'yes\n');
});
