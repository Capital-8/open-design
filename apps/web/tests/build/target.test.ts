import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverTargetAliases, nextTargetResolution, parseWebTarget, prepareTargetTypes, targetCacheRoot, targetProjectRoot } from '../../build/target';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'od-web-target-'));
  roots.push(root);
  const webRoot = join(root, 'apps/web');
  const put = (path: string, content = 'export {};\n') => {
    const file = join(webRoot, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  put('tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'esnext', strict: true, noEmit: true } }));
  put('src/components/Mail/index.ts', "export { value } from '@web-target/components/Mail';\n");
  put('src/components/Mail/Desktop.tsx', "export const value = 'DESKTOP_ONLY';\n");
  put('src/components/Mail/Web.tsx', "export const value = 'WEB_ONLY';\n");
  put('src/runtime/createProject/index.ts', "export { value } from '@web-target/runtime/createProject';\n");
  put('src/runtime/createProject/desktop.ts', "export const value = 'DESKTOP_LOGIC';\n");
  put('src/runtime/createProject/web.ts', "export const value = 'WEB_LOGIC';\n");
  put('src/shared.ts');
  return { webRoot, put };
}

describe('one target module map', () => {
  it('rejects missing, empty and unsupported selections', () => {
    for (const value of [undefined, '', 'cloud', 'Desktop']) expect(() => parseWebTarget(value)).toThrow(/desktop or web/);
  });

  it.each(['desktop', 'web'] as const)('resolves components and operations to %s in Next and TypeScript', target => {
    const { webRoot } = fixture();
    const { aliases, turbopack } = nextTargetResolution(webRoot, target);
    expect(Object.keys(aliases)).toEqual(['@web-target/components/Mail', '@web-target/runtime/createProject']);
    for (const [key, value] of Object.entries(turbopack.resolveAlias)) expect(resolve(webRoot, value)).toBe(aliases[key]);
    const configPath = join(targetCacheRoot(webRoot, target), 'typecheck/tsconfig.json');
    prepareTargetTypes({ webRoot, target, projectRoot: targetProjectRoot(webRoot, target), aliases, configPath });
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath));
    for (const [alias, implementation] of Object.entries(aliases)) {
      const resolution = ts.resolveModuleName(alias, join(webRoot, 'src/caller.ts'), parsed.options, ts.sys);
      expect(resolution.resolvedModule?.resolvedFileName).toBe(implementation);
      expect(implementation.endsWith(target === 'desktop' ? 'Desktop.tsx' : 'Web.tsx') || implementation.endsWith(`${target}.ts`)).toBe(true);
    }
  });

  it('isolates projects, generated configs and incremental state without editing source', () => {
    const { webRoot } = fixture();
    const originalIndex = readFileSync(join(webRoot, 'src/components/Mail/index.ts'), 'utf8');
    const configs = (['desktop', 'web'] as const).map(target => {
      const configPath = join(targetCacheRoot(webRoot, target), 'typecheck/tsconfig.json');
      prepareTargetTypes({ webRoot, target, projectRoot: targetProjectRoot(webRoot, target), aliases: discoverTargetAliases(join(webRoot, 'src'), target), configPath });
      return JSON.parse(readFileSync(configPath, 'utf8'));
    });
    expect(configs[0].compilerOptions.tsBuildInfoFile).not.toBe(configs[1].compilerOptions.tsBuildInfoFile);
    expect(configs[0].compilerOptions.paths).not.toEqual(configs[1].compilerOptions.paths);
    expect(targetProjectRoot(webRoot, 'desktop')).not.toBe(targetProjectRoot(webRoot, 'web'));
    expect(readFileSync(join(webRoot, 'src/components/Mail/index.ts'), 'utf8')).toBe(originalIndex);
  });

  it('fails a partial or ambiguous pair instead of silently falling back', () => {
    const { webRoot, put } = fixture();
    rmSync(join(webRoot, 'src/components/Mail/Web.tsx'));
    expect(() => discoverTargetAliases(join(webRoot, 'src'), 'web')).toThrow(/Invalid target module/);
    put('src/components/Mail/Web.tsx');
    put('src/components/Mail/web.ts');
    expect(() => discoverTargetAliases(join(webRoot, 'src'), 'desktop')).toThrow(/exactly one complete/);
  });

  it('picks up a new feature on the next configuration load and keeps shared files out of the map', () => {
    const { webRoot, put } = fixture();
    const before = discoverTargetAliases(join(webRoot, 'src'), 'web');
    put('src/runtime/Mail/index.ts');
    put('src/runtime/Mail/desktop.ts');
    put('src/runtime/Mail/web.ts');
    const after = discoverTargetAliases(join(webRoot, 'src'), 'web');
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1);
    expect(after['@web-target/components/Mail']).toBe(before['@web-target/components/Mail']);
    expect(after['@web-target/runtime/Mail']).toBe(join(webRoot, 'src/runtime/Mail/web.ts'));
  });
});
