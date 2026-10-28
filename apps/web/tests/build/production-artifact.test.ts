import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseWebTarget, targetProjectRoot } from '../../build/target';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = parseWebTarget(process.env.OD_WEB_TARGET ?? 'desktop');
function javascriptBelow(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? javascriptBelow(path) : entry.name.endsWith('.js') ? readFileSync(path, 'utf8') : '';
  }).join('\n');
}

// Opt in only after a production build. Normal source tests must not depend on
// pre-existing artifacts; CI explicitly runs this against each fresh build.
it.runIf(process.env.OD_WEB_VERIFY_BUILD === '1')('ships only the selected real export implementation in the browser bundle', () => {
  const projectRoot = targetProjectRoot(appRoot, target);
  expect(readFileSync(join(projectRoot, 'out/index.html'), 'utf8')).toContain('<html');
  const bundle = javascriptBelow(join(projectRoot, '.next/static'));
  // These are real protocol error messages, retained even by minification.
  const native = 'desktop PDF export unavailable';
  const cloud = 'Cloud export did not return a PDF';
  expect(bundle).toContain(target === 'desktop' ? native : cloud);
  expect(bundle).not.toContain(target === 'desktop' ? cloud : native);
  if (target === 'web') {
    expect(bundle).toContain('Invalid MP4 response');
    for (const nativeMarker of ['Print failed. Please try Export PDF again or use the browser version.', 'persist:open-design-design-browser', 'openDesignDesktop']) {
      expect(bundle).not.toContain(nativeMarker);
    }
  }
  else expect(bundle).not.toContain('Invalid MP4 response');
});
