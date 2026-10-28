import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { discoverTargetAliases, prepareTargetProject, prepareTargetTypes, targetCacheRoot, targetProjectRoot } from '../../build/target';

const run = promisify(execFile);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(appRoot, 'package.json'));
const workspaceRoot = resolve(appRoot, '../..');
const targetModule = join(appRoot, 'build/target.ts');

function javascriptBelow(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? javascriptBelow(path) : entry.name.endsWith('.js') ? readFileSync(path, 'utf8') : '';
  }).join('\n');
}

// Exercises real resolver consumers and Next's export cache behavior with a tiny
// app, without compiling the entire product or needing a daemon/backend.
it('builds isolated desktop/web artifacts and resolves their public entries in TypeScript and Vitest', async () => {
  mkdirSync(join(workspaceRoot, '.tmp'), { recursive: true });
  const root = mkdtempSync(join(workspaceRoot, '.tmp/web-target-smoke-'));
  const webRoot = join(root, 'apps/web');
  const put = (path: string, content: string) => {
    const file = join(webRoot, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    put('package.json', JSON.stringify({ name: 'web-target-fixture', private: true, type: 'module' }));
    symlinkSync(join(appRoot, 'node_modules'), join(webRoot, 'node_modules'), 'junction');
    put('tsconfig.json', JSON.stringify({ compilerOptions: {
      target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, incremental: true, allowImportingTsExtensions: true,
    } }));
    put('src/components/Mail/index.ts', "export { Mail } from '@web-target/components/Mail';\n");
    put('src/runtime/createProject/index.ts', "export { createProject } from '@web-target/runtime/createProject';\n");
    for (const target of ['desktop', 'web'] as const) {
      put(`src/components/Mail/${target === 'desktop' ? 'Desktop' : 'Web'}.tsx`, `'use client';\nexport function Mail() { return <div>${target.toUpperCase()}_MAIL_ONLY</div>; }\n`);
      put(`src/runtime/createProject/${target}.ts`, `export function createProject() { return '${target.toUpperCase()}_LOGIC_ONLY'; }\n`);
    }
    put('app/layout.tsx', "import type { ReactNode } from 'react';\nexport default function Layout({children}: {children: ReactNode}) { return <html><body>{children}</body></html>; }\n");
    put('app/page.tsx', "'use client';\nimport { Mail } from '../src/components/Mail';\nimport { createProject } from '../src/runtime/createProject';\nexport default function Page() { return <><Mail /><p>{createProject()}</p></>; }\n");
    put('next.config.ts', `import type { NextConfig } from 'next';
import { relative } from 'node:path';
import { nextTargetResolution, parseWebTarget } from ${JSON.stringify(targetModule)};
const selection = nextTargetResolution(${JSON.stringify(webRoot)}, parseWebTarget(process.env.OD_WEB_TARGET), process.env.OD_WEB_PROJECT_ROOT);
const config: NextConfig = {
  output: 'export', experimental: { cpus: 1 },
  turbopack: { root: ${JSON.stringify(workspaceRoot)}, ...selection.turbopack },
  typescript: { tsconfigPath: relative(process.env.OD_WEB_PROJECT_ROOT!, process.env.OD_WEB_TSCONFIG_PATH!).replaceAll('\\\\', '/') },
  webpack(config) { config.resolve.alias = { ...config.resolve.alias, ...selection.aliases }; return config; },
};
export default config;\n`);
    put('vitest.config.ts', `import { discoverTargetAliases, parseWebTarget, targetCacheRoot } from ${JSON.stringify(targetModule)};
const target = parseWebTarget(process.env.OD_WEB_TARGET);
export default { root: ${JSON.stringify(webRoot)}, cacheDir: targetCacheRoot(${JSON.stringify(webRoot)}, target) + '/vitest', resolve: { alias: discoverTargetAliases(${JSON.stringify(join(webRoot, 'src'))}, target) }, test: { include: ['tests/public-entry.test.ts'], maxWorkers: 1 } };\n`);
    put('tests/public-entry.test.ts', "import { expect, it } from 'vitest';\nimport { createProject } from '../src/runtime/createProject';\nit('uses the selected public entry', () => expect(createProject()).toBe(process.env.OD_WEB_TARGET!.toUpperCase() + '_LOGIC_ONLY'));\n");

    for (const target of ['desktop', 'web'] as const) {
      const projectRoot = targetProjectRoot(webRoot, target);
      prepareTargetProject(webRoot, projectRoot);
      const configPath = join(targetCacheRoot(webRoot, target), 'build/tsconfig.json');
      prepareTargetTypes({ webRoot, projectRoot, target, configPath, aliases: discoverTargetAliases(join(webRoot, 'src'), target) });
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', OD_WEB_TARGET: target, OD_WEB_PROJECT_ROOT: projectRoot, OD_WEB_TSCONFIG_PATH: configPath };
      const invoke = async (entry: string, args: string[]) => {
        try {
          return await run(process.execPath, [entry, ...args], { cwd: webRoot, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
        } catch (error) {
          const failure = error as Error & { stdout?: string; stderr?: string };
          throw new Error(`${target}: ${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
        }
      };
      await invoke(require.resolve('typescript/bin/tsc'), ['-p', configPath, '--noEmit']);
      await invoke(join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), ['run', '-c', join(webRoot, 'vitest.config.ts')]);
      // Both supported bundlers consume the same selection: tools-dev defaults
      // to webpack; the normal Next build uses Turbopack.
      await invoke(require.resolve('next/dist/bin/next'), ['build', projectRoot, target === 'desktop' ? '--webpack' : '--turbopack']);
      const html = readFileSync(join(projectRoot, 'out/index.html'), 'utf8');
      const bundle = javascriptBelow(join(projectRoot, '.next/static'));
      const selected = target.toUpperCase();
      const excluded = target === 'desktop' ? 'WEB' : 'DESKTOP';
      for (const output of [html, bundle]) {
        expect(output).toContain(`${selected}_MAIL_ONLY`);
        expect(output).toContain(`${selected}_LOGIC_ONLY`);
        expect(output).not.toContain(`${excluded}_MAIL_ONLY`);
        expect(output).not.toContain(`${excluded}_LOGIC_ONLY`);
      }
    }
    expect(readFileSync(join(webRoot, 'out/index.html'), 'utf8')).toContain('DESKTOP_MAIL_ONLY');
    expect(readFileSync(join(webRoot, 'src/components/Mail/index.ts'), 'utf8')).toBe("export { Mail } from '@web-target/components/Mail';\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
