import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionEditorDocument, MotionEditorResponse } from '@open-design/contracts';
import { registerProjectMotionEditorRoutes } from '../../src/routes/project/motion-editor.js';
import { renderMotionEditorDocument, motionEditorRevision } from '../../src/services/motion-editor.js';
import { createPublicFileMutations, type PublicFileMutations } from '../../src/collab/public-file-mutations.js';
import { listProjectFileVersions } from '../../src/project-file-versions.js';
import { readProjectFile, resolveProjectFilePath } from '../../src/projects.js';
const doc: MotionEditorDocument = { schemaVersion: 1, width: 640, height: 360, duration: 3, fps: 30, background: '#ffffff', objects: [
  { id: 'title', name: 'Title', type: 'text', text: 'Hello', x: 20, y: 20, width: 300, height: 100, fontSize: 32, color: '#111111', fill: '#ffffff', rotation: 0, opacity: 1, animation: { preset: 'fade', start: 0, duration: 1, easing: 'gentle' } },
] };
let mutations: PublicFileMutations;
let root = '', base = ''; let server: http.Server; let allow = true; let busy = false;
const read = vi.fn(readProjectFile);
const authorize = vi.fn(async (_req, res, _id, _options) => { if (!allow) { res.status(403).end(); return false; } return true; });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'od-motion-route-'));
  await mkdir(path.join(root, 'project'));
  await writeFile(path.join(root, 'project/gsap.min.js'), await readFile(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js')));
  await writeFile(path.join(root, 'project/index.html'), renderMotionEditorDocument(doc));
  mutations = createPublicFileMutations();
  allow = true; busy = false; read.mockClear(); authorize.mockClear();
  const app = express(); app.use(express.json());
  registerProjectMotionEditorRoutes(app, {
    db: {}, publicFileMutations: mutations, paths: { PROJECTS_DIR: root }, projectStore: { getProject: (_db, id) => id === 'missing' ? null : { id, metadata: { kind: id === 'web' ? 'prototype' : 'video', intent: 'motion-design' } } },
    projectFiles: { readProjectFile: read, resolveProjectFilePath }, authorizeProjectRequest: authorize,
    isProjectEditingBusy: () => busy,
    http: { sendApiError: (res, status, code, message) => res.status(status).json({ error: { code, message } }) },
  });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
function call(operation: 'read' | 'preview' | 'save', body: unknown, id = 'project') {
  return fetch(`${base}/api/projects/${id}/motion/editor/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
describe('Motion editor routes', () => {
  it('requires appropriate authority before reading or writing and gates non-Motion projects', async () => {
    allow = false;
    expect((await call('read', { filePath: 'index.html' })).status).toBe(403);
    expect((await call('save', { filePath: 'index.html' })).status).toBe(403);
    expect(authorize.mock.calls[0]?.[3]).toEqual({ mode: 'read' });
    expect(authorize.mock.calls[1]?.[3]).toEqual({ mode: 'write', capability: 'writeFiles' });
    expect(read).not.toHaveBeenCalled(); allow = true;
    expect(await (await call('read', { filePath: 'index.html' }, 'web')).json()).toMatchObject({ supported: false });
    expect((await call('save', { filePath: 'index.html' }, 'web')).status).toBe(400);
  });
  it('rejects paths and symlink escapes', async () => {
    for (const filePath of ['../index.html', '/index.html', '.od/versions/a.html', 'a.txt']) expect((await call('read', { filePath })).status).toBeGreaterThanOrEqual(400);
    await writeFile(path.join(root, 'outside.html'), 'secret');
    await symlink(path.join(root, 'outside.html'), path.join(root, 'project/escape.html'));
    const response = await call('read', { filePath: 'escape.html' }); expect(response.status).toBe(400); expect(await response.text()).not.toContain(root);
  });
  it('refuses altered runtime dependencies before exposing editable controls', async () => {
    await writeFile(path.join(root, 'project/gsap.min.js'), 'window.gsap = malicious;');
    expect(await (await call('read', { filePath: 'index.html' })).json()).toMatchObject({ supported: false });
    const response = await call('save', { filePath: 'index.html', baseRevision: motionEditorRevision(renderMotionEditorDocument(doc)), document: doc });
    expect(response.status).toBe(409);
  });
  it('renders read-only previews without changing source or version history, and rejects stale previews', async () => {
    const source = renderMotionEditorDocument(doc);
    const preview = await call('preview', { filePath: 'index.html', baseRevision: motionEditorRevision(source), document: { ...doc, background: '#222222' } });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ source: renderMotionEditorDocument({ ...doc, background: '#222222' }) });
    expect(authorize.mock.calls.at(-1)?.[3]).toEqual({ mode: 'read' });
    expect(await readFile(path.join(root, 'project/index.html'), 'utf8')).toBe(source);
    expect(await listProjectFileVersions(root, 'project', 'index.html')).toEqual([]);
    expect((await call('preview', { filePath: 'index.html', baseRevision: '0'.repeat(64), document: doc })).status).toBe(409);
  });
  it('queues saves behind the shared project mutation lane', async () => {
    let release!: () => void;
    const held = mutations.run('project', async () => new Promise<void>(resolve => { release = resolve; }));
    // The lane acquisition yields once before entering its operation.
    await Promise.resolve(); await Promise.resolve();
    const original = mutations.run.bind(mutations);
    let admitted!: () => void;
    const queued = new Promise<void>(resolve => { admitted = resolve; });
    vi.spyOn(mutations, 'run').mockImplementation((ids, operation, options) => { admitted(); return original(ids, operation, options); });
    const pending = call('save', { filePath: 'index.html', baseRevision: motionEditorRevision(renderMotionEditorDocument(doc)), document: { ...doc, background: '#222222' } });
    await queued;
    expect(await readFile(path.join(root, 'project/index.html'), 'utf8')).toBe(renderMotionEditorDocument(doc));
    release(); await held;
    expect((await pending).status).toBe(200);
  });
  it('roundtrips same API for UI/CLI and refuses stale revision or active generation', async () => {
    const initial = await (await call('read', { filePath: 'index.html' })).json() as Extract<MotionEditorResponse, { supported: true }>;
    expect(initial.revision).toBe(motionEditorRevision(initial.source));
    const request = { filePath: 'index.html', baseRevision: initial.revision, document: { ...doc, background: '#eeeeee' } };
    busy = true; expect((await call('save', request)).status).toBe(409); busy = false;
    const saved = await call('save', request); expect(saved.status).toBe(200);
    expect((await saved.json() as Extract<MotionEditorResponse, { supported: true }>).document.background).toBe('#eeeeee');
    expect((await call('save', request)).status).toBe(409);
  });
});
