import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';

const previewModule = Object.values(import.meta.glob<{
  inferPluginPreview: (record: InstalledPluginRecord, opts: { preferBaked: boolean }) => unknown;
}>('../../apps/web/src/components/plugins-home/preview.ts', { eager: true }))[0]!;
const facetsModule = Object.values(import.meta.glob<{
  extractCategories: (record: InstalledPluginRecord) => string[];
}>('../../apps/web/src/components/plugins-home/facets.ts', { eager: true }))[0]!;

const modelCatalogues = import.meta.glob<{
  VIDEO_MODELS: { id: string }[];
}>('../../apps/{daemon,web}/src/media/models.ts', { eager: true });

const pluginRoot = fileURLToPath(new URL('../../plugins/_official/examples/claude-animation/', import.meta.url));

it('offers hand-painted animation as a Motion template, not a standalone video model in the web picker', () => {
  const entries = Object.entries(modelCatalogues);
  const web = entries.find(([file]) => file.includes('/apps/web/'))![1];
  const daemon = entries.find(([file]) => file.includes('/apps/daemon/'))![1];
  expect(web.VIDEO_MODELS.some(({ id }) => id === 'claude-animation-p5')).toBe(false);
  // The daemon keeps the compatible internal renderer id for scaffolded sources.
  expect(daemon.VIDEO_MODELS.some(({ id }) => id === 'claude-animation-p5')).toBe(true);
});

it('shows the bundled hand-painted sample under Motion design with its own poster and video', async () => {
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'open-design.json'), 'utf8'));
  const record = { id: manifest.name, title: manifest.title, manifest } as InstalledPluginRecord;
  expect(previewModule.inferPluginPreview(record, { preferBaked: true })).toMatchObject({
    kind: 'media',
    mediaType: 'video',
    poster: '/api/plugins/example-claude-animation/asset/assets/cover.jpg',
    videoUrl: '/api/plugins/example-claude-animation/asset/assets/example.mp4',
  });
  expect(facetsModule.extractCategories(record)).toEqual(['motion-design']);
  for (const asset of [manifest.od.preview.poster, manifest.od.preview.video]) {
    expect((await stat(path.join(pluginRoot, asset))).size).toBeGreaterThan(0);
  }
});

it('ships the original-character starter and separate p5 license/source notices', async () => {
  const runtime = path.join(pluginRoot, 'runtime');
  const starter = await readFile(path.join(runtime, 'template.html'), 'utf8');
  expect(starter).toContain('function bird(t)');
  expect(starter).not.toMatch(/clawd\(|Clawd/);
  await expect(stat(path.join(runtime, 'clawd.js'))).rejects.toThrow();
  expect(await readFile(path.join(runtime, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2026 John Heibel');
  expect(await readFile(path.join(runtime, 'licenses/p5-LGPL-2.1.txt'), 'utf8')).toContain('Version 2.1, February 1999');
  expect(await readFile(path.join(runtime, 'licenses/p5.brush-MIT.txt'), 'utf8')).toContain('Alejandro Campos Uribe');
  const source = await readFile(path.join(runtime, 'licenses/p5-2.3.3-source.tar.gz'));
  expect(createHash('sha256').update(source).digest('hex'))
    .toBe('82ce89f35c4a4155ac9c3c7ec43d399e9a63ba905314abbb7a699e27e23ebd61');
  const archive = gunzipSync(source).toString('utf8');
  expect(archive).toContain('p5.js-2.3.3/src/');
  expect(archive).toContain('package-lock.json');
});
