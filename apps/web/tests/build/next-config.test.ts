import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const run = promisify(execFile);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

it('loads real Next target configuration from an operator working directory', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'od-next-config-'));
  try {
    const script = `
      import { createRequire } from 'node:module';
      const root = ${JSON.stringify(webRoot)};
      const require = createRequire(root + '/package.json');
      const { transpileConfig } = require('next/dist/build/next-config-ts/transpile-config');
      const loaded = await transpileConfig({ nextConfigPath: root + '/next.config.ts', dir: root });
      console.log(JSON.stringify(loaded.default.turbopack.resolveAlias));
    `;
    const result = await run(process.execPath, ['--input-type=module', '--eval', script], {
      cwd,
      env: {
        ...process.env,
        OD_WORKSPACE_ROOT: resolve(webRoot, '../..'),
        OD_WEB_TARGET: 'web',
        OD_WEB_PROJECT_ROOT: webRoot,
        __NEXT_NODE_NATIVE_TS_LOADER_ENABLED: 'false',
      },
      timeout: 30_000,
    });
    const aliases = JSON.parse(result.stdout.trim());
    expect(aliases['@web-target/runtime/cloud-device-login']).toMatch(/cloud-device-login\/web\.ts$/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
