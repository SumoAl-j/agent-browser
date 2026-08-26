import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const launcherPath = join(repositoryRoot, 'bin', 'agent-browser.js');

async function runLauncher(t, { platform, arch, binaryName, args }) {
  const packageRoot = await mkdtemp(join(tmpdir(), 'agent-browser-launcher-'));
  const binDirectory = join(packageRoot, 'bin');
  const copiedLauncherPath = join(binDirectory, 'agent-browser.js');
  const bootstrapPath = join(packageRoot, 'bootstrap.mjs');
  const fakeBinaryPath = join(binDirectory, binaryName);

  t.after(() => rm(packageRoot, { recursive: true, force: true }));

  await mkdir(binDirectory, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n');
  await copyFile(launcherPath, copiedLauncherPath);
  await chmod(copiedLauncherPath, 0o755);
  await writeFile(
    bootstrapPath,
    `import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const os = require('node:os');
os.platform = () => ${JSON.stringify(platform)};
os.arch = () => ${JSON.stringify(arch)};
syncBuiltinESMExports();

await import('./bin/agent-browser.js');
`,
  );
  await writeFile(
    fakeBinaryPath,
    `#!/bin/sh
printf '%s\\n' 'fake-binary-ran' "$@"
`,
  );
  await chmod(fakeBinaryPath, 0o755);

  return spawnSync(process.execPath, [bootstrapPath, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
}

test('Windows ARM64 launcher uses the published x64 executable', async (t) => {
  const args = ['open', 'https://example.com'];
  const result = await runLauncher(t, {
    platform: 'win32',
    arch: 'arm64',
    binaryName: 'agent-browser-win32-x64.exe',
    args,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), ['fake-binary-ran', ...args]);
  assert.doesNotMatch(result.stderr, /No binary found/);
});

test('macOS ARM64 launcher keeps selecting the ARM64 executable', async (t) => {
  const args = ['--version'];
  const result = await runLauncher(t, {
    platform: 'darwin',
    arch: 'arm64',
    binaryName: 'agent-browser-darwin-arm64',
    args,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), ['fake-binary-ran', ...args]);
});
