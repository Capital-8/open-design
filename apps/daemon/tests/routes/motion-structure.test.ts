import http from 'node:http';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionSourceFingerprint, type MotionStructureResponse } from '@open-design/contracts/api/motionStructure';
import { registerProjectMotionStructureRoutes } from '../../src/routes/project/motion-structure.js';
import { readProjectFile, resolveProjectFilePath } from '../../src/projects.js';
import { MOTION_STRUCTURE_MAX_SOURCE_BYTES } from '../../src/services/motion-structure.js';

const source = '<meta name="od-motion-output" content="video"><main data-composition-id="test" data-duration="5" data-width="800" data-height="600"><section data-start="0" data-duration="5"><h2>Disk title</h2></section></main>';
let root = '';
let server: http.Server | undefined;
let base = '';
let allowRead = true;
const authorize = vi.fn(async (_req, res, _id, options) => {
  expect(options).toEqual({ mode: 'read' });
  if (!allowRead) { res.status(403).json({ error: { code: 'WORKSPACE_PROJECT_PERMISSION_DENIED', message: 'denied' } }); return false; }
  return true;
});
const read = vi.fn(readProjectFile);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'od-motion-structure-'));
  await mkdir(path.join(root, 'project-1'));
  await writeFile(path.join(root, 'project-1', 'index.html'), source);
  allowRead = true;
  authorize.mockClear();
  read.mockClear();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  registerProjectMotionStructureRoutes(app, {
    db: {}, paths: { PROJECTS_DIR: root },
    projectStore: { getProject: (_db, id) => id === 'project-1' ? { id, metadata: null } : null },
    projectFiles: { readProjectFile: read, resolveProjectFilePath },
    authorizeProjectRequest: authorize,
    http: { sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }) },
  } as Parameters<typeof registerProjectMotionStructureRoutes>[1]);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

function inspect(body: unknown, id = 'project-1') {
  return fetch(`${base}/api/projects/${id}/motion/structure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST project Motion structure', () => {
  it('reads disk by default and parses supplied exact source without reading disk bytes', async () => {
    const disk = await inspect({ filePath: 'index.html' });
    expect(disk.status).toBe(200);
    expect((await disk.json() as MotionStructureResponse).sourceFingerprint).toBe(motionSourceFingerprint(source));
    expect(read).toHaveBeenCalledTimes(1);
    read.mockClear();
    const supplied = source.replace('Disk title', 'Unsaved title');
    const response = await inspect({ filePath: 'index.html', source: supplied });
    const body = await response.json() as MotionStructureResponse;
    expect(response.status).toBe(200);
    expect(body.sourceFingerprint).toBe(motionSourceFingerprint(supplied));
    expect(body.texts[0]!.text).toBe('Unsaved title');
    expect(read).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('enforces project read authority before any file access, including supplied source', async () => {
    allowRead = false;
    expect((await inspect({ filePath: 'index.html', source })).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect((await inspect({ filePath: 'index.html' }, 'unknown')).status).toBe(404);
  });

  it.each(['../outside.html', '/etc/passwd', 'C:\\secret.html', '.od/versions/a.html', 'index.txt'])('rejects unsafe or non-HTML path %s', async (filePath) => {
    const response = await inspect({ filePath, source });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects symlink escapes even with supplied source, without leaking outside paths', async () => {
    const outside = path.join(root, 'outside.html');
    await writeFile(outside, 'secret');
    await symlink(outside, path.join(root, 'project-1', 'escape.html'));
    const response = await inspect({ filePath: 'escape.html', source });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(root);
  });

  it('bounds supplied and disk source and rejects malformed input', async () => {
    const large = 'x'.repeat(MOTION_STRUCTURE_MAX_SOURCE_BYTES + 1);
    expect((await inspect({ filePath: 'index.html', source: large })).status).toBe(413);
    await writeFile(path.join(root, 'project-1', 'large.html'), large);
    expect((await inspect({ filePath: 'large.html' })).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect((await inspect({ filePath: 'index.html', source: {} })).status).toBe(400);
    const empty = await inspect({ filePath: 'index.html', source: '' });
    expect(empty.status).toBe(200);
    expect((await empty.json() as MotionStructureResponse).sourceFingerprint).toBe(motionSourceFingerprint(''));
  });
});
