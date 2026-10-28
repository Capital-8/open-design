import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type WebTarget = 'desktop' | 'web';
export type TargetAliases = Record<string, string>;

export function parseWebTarget(value: string | undefined): WebTarget {
  if (value !== 'desktop' && value !== 'web') {
    throw new Error('OD_WEB_TARGET / --target must be desktop or web');
  }
  return value;
}

const posix = (value: string) => value.replaceAll('\\', '/');
const relativeFile = (from: string, to: string) => {
  const path = posix(relative(from, to));
  return path.startsWith('.') ? path : `./${path}`;
};

/** Directory-relative aliases avoid collisions between equally named features. */
export function discoverTargetAliases(sourceRoot: string, target: WebTarget): TargetAliases {
  const aliases: TargetAliases = {};
  if (!existsSync(sourceRoot)) return aliases;
  function visit(directory: string) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
    const component = names.has('Desktop.tsx') || names.has('Web.tsx');
    const operation = names.has('desktop.ts') || names.has('web.ts');
    if (component || operation) {
      const variants = component ? ['Desktop.tsx', 'Web.tsx'] : ['desktop.ts', 'web.ts'];
      if ((component && operation) || !names.has('index.ts') || variants.some(name => !names.has(name))) {
        throw new Error(`Invalid target module ${directory}: require index.ts and exactly one complete Desktop.tsx/Web.tsx or desktop.ts/web.ts pair`);
      }
      const feature = posix(relative(sourceRoot, directory));
      if (!feature) throw new Error('Target variants must live in a feature directory below src');
      aliases[`@web-target/${feature}`] = join(directory, variants[target === 'desktop' ? 0 : 1]!);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') visit(join(directory, entry.name));
    }
  }
  visit(sourceRoot);
  return aliases;
}

export function targetCacheRoot(webRoot: string, target: WebTarget): string {
  return resolve(webRoot, '../../.tmp/web-targets', target);
}

/** Desktop retains the published package layout. Web gets its own Next project,
 * including .next, out and next-env.d.ts (Next export resets custom distDir). */
export function targetProjectRoot(webRoot: string, target: WebTarget, runtimeRoot?: string): string {
  return target === 'desktop' ? webRoot : join(runtimeRoot ?? join(targetCacheRoot(webRoot, target), 'build'), 'project');
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function linkSource(source: string, destination: string): void {
  if (!existsSync(source)) return;
  const current = lstatSync(destination, { throwIfNoEntry: false });
  if (current) {
    if (current.isSymbolicLink() && realpathSync(destination) === realpathSync(source)) return;
    throw new Error(`Refusing to replace a non-matching build input: ${destination}`);
  }
  symlinkSync(source, destination, lstatSync(source).isDirectory() ? 'junction' : 'file');
}

function removeRouteLinks(path: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) unlinkSync(path);
  else if (entry.isDirectory()) {
    for (const name of readdirSync(path)) removeRouteLinks(join(path, name));
    rmdirSync(path);
  } else throw new Error(`Refusing to remove a non-generated route input: ${path}`);
}

/** Turbopack discovers real route directories, but follows linked route files. */
function linkRoutes(source: string, destination: string): void {
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    if (realpathSync(destination) !== realpathSync(source)) throw new Error(`Unexpected route link: ${destination}`);
    unlinkSync(destination);
  }
  mkdirSync(destination, { recursive: true });
  const entries = readdirSync(source, { withFileTypes: true });
  const names = new Set(entries.map(entry => entry.name));
  for (const name of readdirSync(destination)) if (!names.has(name)) removeRouteLinks(join(destination, name));
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) linkRoutes(from, to);
    else linkSource(from, to);
  }
}

export function prepareTargetProject(webRoot: string, projectRoot: string): void {
  if (projectRoot === webRoot) return;
  mkdirSync(projectRoot, { recursive: true });
  linkRoutes(join(webRoot, 'app'), join(projectRoot, 'app'));
  for (const name of ['src', 'public', 'node_modules', 'package.json', 'postcss.config.mjs', 'postcss.config.ts', ...readdirSync(webRoot).filter(name => /^\.env(?:\.|$)/.test(name))]) {
    linkSource(join(webRoot, name), join(projectRoot, name));
  }
  // Copy only this small forwarding entry, never mutate the application's entry.
  const configImport = posix(join(webRoot, 'next.config.ts'));
  writeIfChanged(join(projectRoot, 'next.config.ts'), `export { default } from ${JSON.stringify(configImport)};\n`);
}

export function prepareTargetTypes(options: {
  webRoot: string;
  projectRoot: string;
  target: WebTarget;
  aliases: TargetAliases;
  configPath: string;
  distDir?: string;
}): string {
  const { webRoot, projectRoot, target, aliases, configPath } = options;
  const configRoot = dirname(configPath);
  const distDir = options.distDir ?? join(projectRoot, '.next');
  const paths = Object.fromEntries(Object.entries(aliases).map(([key, value]) => [key, [relativeFile(configRoot, value)]]));
  mkdirSync(configRoot, { recursive: true });
  linkSource(join(webRoot, 'node_modules'), join(configRoot, 'node_modules'));
  writeIfChanged(join(configRoot, 'next-env.d.ts'), '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
  writeIfChanged(configPath, `${JSON.stringify({
    extends: relativeFile(configRoot, join(webRoot, 'tsconfig.json')),
    compilerOptions: {
      paths: { '@/*': [relativeFile(configRoot, join(webRoot, '*'))], ...paths },
      tsBuildInfoFile: posix(join(configRoot, 'tsconfig.tsbuildinfo')),
    },
    include: [
      posix(join(configRoot, 'next-env.d.ts')),
      ...['next.config.ts', 'build/**/*.ts', 'app/**/*', 'src/**/*', 'sidecar/**/*', 'tests/**/*'].map(path => posix(join(webRoot, path))),
      posix(join(distDir, 'types/**/*.ts')),
      posix(join(distDir, 'dev/types/**/*.ts')),
    ],
    exclude: [posix(join(webRoot, 'node_modules')), posix(join(projectRoot, 'node_modules'))],
  }, null, 2)}\n`);
  writeIfChanged(join(configRoot, 'target.json'), `${JSON.stringify({ target, aliases }, null, 2)}\n`);
  return configPath;
}

export function nextTargetResolution(webRoot: string, target: WebTarget, projectRoot = webRoot) {
  const aliases = discoverTargetAliases(join(webRoot, 'src'), target);
  return {
    aliases,
    // Turbopack treats leading '/' as a server-relative import, unlike webpack.
    turbopack: { resolveAlias: Object.fromEntries(Object.entries(aliases).map(([key, value]) => [key, relativeFile(projectRoot, value)])) },
  };
}

export function absoluteFrom(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}
