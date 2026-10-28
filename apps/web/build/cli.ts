import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteFrom, discoverTargetAliases, parseWebTarget, prepareTargetProject, prepareTargetTypes, targetCacheRoot, targetProjectRoot } from './target.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(webRoot, 'package.json'));
const [command, ...rawArgs] = process.argv.slice(2);
if (!['build', 'dev', 'test', 'typecheck'].includes(command ?? '')) throw new Error('Expected build, dev, test or typecheck');
const args: string[] = [];
// Existing commands explicitly default to desktop; a supplied value is validated.
let targetValue = process.env.OD_WEB_TARGET ?? 'desktop';
for (let index = 0; index < rawArgs.length; index++) {
  const arg = rawArgs[index]!;
  if (arg === '--') continue;
  if (arg === '--target') {
    const value = rawArgs[++index];
    if (!value || value.startsWith('-')) throw new Error('--target requires desktop or web');
    targetValue = value;
  } else if (arg.startsWith('--target=')) targetValue = arg.slice('--target='.length);
  else args.push(arg);
}
const target = parseWebTarget(targetValue);
const cacheRoot = targetCacheRoot(webRoot, target);
const projectRoot = targetProjectRoot(webRoot, target);
const env = { ...process.env, OD_WEB_TARGET: target, OD_WEB_PROJECT_ROOT: projectRoot };
let entry: string;
let childArgs: string[];
if (command === 'test') {
  entry = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  childArgs = ['run', '-c', join(webRoot, 'vitest.config.ts'), '--maxWorkers=2', ...args];
} else {
  const configPath = join(cacheRoot, command === 'typecheck' ? 'typecheck' : 'build', 'tsconfig.json');
  const distDir = process.env.OD_WEB_DIST_DIR ? absoluteFrom(projectRoot, process.env.OD_WEB_DIST_DIR) : join(projectRoot, '.next');
  prepareTargetTypes({ webRoot, projectRoot, target, aliases: discoverTargetAliases(join(webRoot, 'src'), target), configPath, distDir });
  Object.assign(env, { OD_WEB_TSCONFIG_PATH: configPath });
  if (command === 'typecheck') {
    entry = require.resolve('typescript/bin/tsc');
    childArgs = ['-p', configPath, '--noEmit', ...args];
  } else {
    prepareTargetProject(webRoot, projectRoot);
    entry = require.resolve('next/dist/bin/next');
    childArgs = [command!, projectRoot, ...(command === 'dev' ? ['--turbopack'] : []), ...args];
    process.stdout.write(`[web:${target}] project: ${projectRoot}\n`);
  }
}
const child = spawn(process.execPath, [entry, ...childArgs], { cwd: webRoot, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.once('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
