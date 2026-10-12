import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';

const previewModule = Object.values(import.meta.glob<{
  inferPluginPreview: (record: InstalledPluginRecord, opts: { preferBaked: boolean }) => unknown;
}>('../../apps/web/src/components/plugins-home/preview.ts', { eager: true }))[0]!;
const facetsModule = Object.values(import.meta.glob<{
  extractCategories: (record: InstalledPluginRecord) => string[];
  extractSubcategories: (record: InstalledPluginRecord, category: string) => string[];
}>('../../apps/web/src/components/plugins-home/facets.ts', { eager: true }))[0]!;

it('shows the bundled Claude Animation sample in Home and the Community video category without a CDN bake', async () => {
  const root = fileURLToPath(new URL('../../plugins/_official/examples/claude-animation/', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, 'open-design.json'), 'utf8'));
  const record = { id: manifest.name, title: manifest.title, manifest } as InstalledPluginRecord;
  const preview = previewModule.inferPluginPreview(record, { preferBaked: true });
  expect(preview).toMatchObject({
    kind: 'media',
    mediaType: 'video',
    poster: '/api/plugins/example-claude-animation/asset/assets/poster.jpg',
    videoUrl: '/api/plugins/example-claude-animation/asset/assets/example.mp4',
  });
  expect(facetsModule.extractCategories(record)).toEqual(['video']);
  expect(facetsModule.extractSubcategories(record, 'video')).toEqual(['motion-effects']);
  for (const asset of [manifest.od.preview.poster, manifest.od.preview.video]) {
    expect((await stat(path.join(root, asset))).size).toBeGreaterThan(0);
  }
});
