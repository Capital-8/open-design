import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:https';
import { expect, it } from 'vitest';
import { startPublicShareFixture } from '@/playwright/public-share-fixture';

it('fixture serves acknowledged immutable upload, stops access and retains the alias on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'od-share-fixture-'));
  for (const [v, text] of [[1, 'V1'], [2, 'V2']] as const) { await mkdir(join(root, `v${v}`)); await writeFile(join(root, `v${v}`, 'index.html'), text); }
  const resource = { snapshotDir: join(root, 'v2'), version: 2, versions: new Map([[1, join(root, 'v1')], [2, join(root, 'v2')]]), ownerMemberId: 'A' };
  const fixture = await startPublicShareFixture({ resource: id => id === 'resource' ? resource : undefined, project: id => id === 'project' ? { ownerMemberId: 'A', metadata: { _commentFiles: { files: [{ sourceFilePath: 'index.html', sourceFileId: 'file-id' }] } } } : undefined });
  const read = (path: string) => new Promise<{ status: number; body: string }>((done, fail) => {
    get(fixture.origin + path, { rejectUnauthorized: false }, res => { let body = ''; res.on('data', b => { body += String(b); }); res.on('end', () => done({ status: res.statusCode!, body })); }).on('error', fail);
  });
  const publish = (version: string) => fixture.command(['share', 'publish', 'resource', '--project-id', 'project', '--slug', 'alias', '--version-id', version, '--source-file-path', 'index.html', '--entry-path', 'index.html'], 'A');
  try {
    expect(() => fixture.command(['share', 'project-status', 'project'], 'B')).toThrow('share_owner_required');
    expect(() => publish('v9')).toThrow('unverified_publish');
    publish('v1'); expect(await read('/artifact/project/alias/')).toEqual({ status: 200, body: 'V1' });
    publish('v2'); expect(await read('/artifact/project/alias/')).toEqual({ status: 200, body: 'V2' });
    fixture.command(['share', 'stop', 'alias', '--project-id', 'project'], 'A'); expect((await read('/artifact/project/alias/')).status).toBe(410);
    fixture.command(['share', 'resume-existing', 'alias', '--project-id', 'project'], 'A'); expect(await read('/artifact/project/alias/')).toEqual({ status: 200, body: 'V2' });
    expect((await read('/api/projects/project')).status).toBe(404);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
