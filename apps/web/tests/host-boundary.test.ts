import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function filesUnder(dir: string): string[] {
  const entries = readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return filesUnder(path);
    return path;
  });
  return entries.filter((path) => /\.(ts|tsx|cts|mts)$/.test(path));
}

describe('host bridge boundary', () => {
  it('keeps web source and tests from directly reading preload globals', () => {
    const forbidden = [
      'electronAPI',
      '__odDesktop',
      '__OD_CLIENT_TYPE__',
      '__od__',
      'OPEN_DESIGN_HOST_GLOBAL',
    ];
    const candidates = [
      ...filesUnder(join(webRoot, 'src')),
      ...filesUnder(join(webRoot, 'tests')).filter((path) => !path.endsWith('host-boundary.test.ts')),
    ];
    const offenders = candidates.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return forbidden
        .filter((token) => source.includes(token))
        .map((token) => `${path.replace(`${webRoot}/`, '')}: ${token}`);
    });
    expect(offenders).toEqual([]);
  });
});

it('keeps runtime host access inside selected desktop implementations', () => {
  const offenders: string[] = [];
  for (const path of filesUnder(join(webRoot, 'src'))) {
    if (/(?:^|\/)(?:desktop\.ts|Desktop\.tsx)$/.test(path)) continue;
    const source = readFileSync(path, 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const node of file.statements) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '@open-design/host') {
        const clause = node.importClause;
        if (clause?.isTypeOnly) continue;
        const bindings = clause?.namedBindings;
        // Protocol constants and type imports are shared; native actions/detection are not.
        if (clause?.name || (bindings && (!ts.isNamedImports(bindings) || bindings.elements.some(binding => !binding.isTypeOnly && !binding.name.text.startsWith('OPEN_DESIGN_HOST_'))))) {
          offenders.push(path.replace(`${webRoot}/`, ''));
        }
      }
    }
    if (source.includes('openDesignDesktop')) offenders.push(path.replace(`${webRoot}/`, ''));
  }
  expect(offenders).toEqual([]);
});
