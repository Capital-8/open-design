import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, closeDatabase, upsertMessage, listMessages } from '../../src/db.js';
import { StandaloneConversationService } from '../../src/storage/standalone-conversations.js';
import { registerStandaloneConversationRoutes } from '../../src/routes/standalone-conversations.js';
import { workspaceContextFromDirectoryItem } from '../../src/collab/vela-workspace-context.js';
import { openDesignAmrTraceEnvForRun } from '../../src/runtimes/project-amr-trace-env.js';
async function readJson(response: Response): Promise<Record<string, any>> { return await response.json() as Record<string, any>; }
describe('standalone conversation API', () => {
  let dir: string; let server: Server; let url: string; let service: StandaloneConversationService; let db: ReturnType<typeof openDatabase>;
  const runs = { list: vi.fn(() => [] as unknown[]), cancel: vi.fn(async () => {}) };
  const headers = (member = 'member-a') => ({ 'content-type':'application/json', 'x-od-workspace-id':'workspace-a', 'x-od-workspace-member-id':member });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), '.od-standalone-api-')); db = openDatabase(dir, {dataDir:dir});
    const verify = vi.fn(async (req: unknown) => {
      const member = (req as express.Request).get('x-od-workspace-member-id')!;
      if (member === 'removed') return { ok:false as const, status:403 as const, code:'WORKSPACE_ACCESS_DENIED', message:'removed' };
      return { ok:true as const, context:workspaceContextFromDirectoryItem({ workspaceId:'workspace-a',workspaceName:'A',workspaceType:'personal',workspaceMemberId:member,role:'owner',memberStatus:'active',lifecycleState:'active' }, {}) };
    });
    service = new StandaloneConversationService({ db, runtimeDataDir:dir, verifyRead:verify, verifyWrite:verify });
    const app = express(); app.use(express.json()); registerStandaloneConversationRoutes(app, {db,standaloneConversations:service,design:{runs},previewOrigins:()=>['http://127.0.0.1:45232']});
    server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); closeDatabase(); await rm(dir,{recursive:true,force:true}); vi.clearAllMocks(); });
  async function create(scoped = true) {
    const response = await fetch(`${url}/api/conversations`, {method:'POST',headers:scoped ? headers() : {'content-type':'application/json'},body:JSON.stringify({title:'Independent'})});
    expect(response.status).toBe(201); return (await readJson(response)).conversation.id as string;
  }
  it('creates no project and isolates list/direct reads by member', async () => {
    const id = await create(); expect(db.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({n:0}); expect(service.get(id)?.projectId).toBeNull();
    expect((await fetch(`${url}/api/conversations`,{headers:headers()}).then(readJson)).conversations.map((c:{id:string})=>c.id)).toEqual([id]);
    for (const requestHeaders of [headers('member-b'), {}]) {
      expect((await fetch(`${url}/api/conversations/${id}`,{headers:requestHeaders})).status).toBe(404);
      expect((await fetch(`${url}/api/conversations`,{headers:requestHeaders}).then(readJson)).conversations).toEqual([]);
    }
    expect((await fetch(`${url}/api/conversations/${id}`,{headers:headers('removed')})).status).toBe(403);
    expect((await fetch(`${url}/api/conversations/${id}`,{method:'PATCH',headers:headers(),body:JSON.stringify({title:'Renamed'})})).status).toBe(200); expect(service.get(id)?.title).toBe('Renamed');
  });
  it('returns the latest conversation run state in the scoped catalogue', async () => {
    const id = await create(false);
    runs.list.mockReturnValueOnce([
      { createdAt: 1, status: 'failed' },
      { createdAt: 2, status: 'running' },
    ]);
    const result = await fetch(`${url}/api/conversations`).then(readJson);
    expect(result.conversations[0]).toMatchObject({ id, runStatus: 'running' });
    expect(runs.list).toHaveBeenCalledWith({ conversationId: id });
  });
  it('rejects non-string session modes before SQLite mutation', async () => {
    const response = await fetch(`${url}/api/conversations`, {method:'POST',headers:headers(),body:JSON.stringify({sessionMode:['chat']})});
    expect(response.status).toBe(400);
  });
  it('serves files under a hidden runtime root while refusing hidden files and traversal/symlink escapes', async () => {
    const id = await create(false); const cwd = await service.ensureWorkspace(id); expect(await service.ensureWorkspace(id)).toBe(cwd);
    const form = new FormData(); form.append('files',new Blob(['<h1>Artifact</h1>']),'result.html');
    const upload = await fetch(`${url}/api/conversations/${id}/upload`,{method:'POST',body:form}).then(readJson); expect(upload.files).toHaveLength(1);
    const raw = await fetch(`${url}/api/conversations/${id}/files/raw?path=${upload.files[0].name}`); expect(await raw.text()).toBe('<h1>Artifact</h1>'); expect(raw.headers.get('content-security-policy')).toContain('sandbox allow-scripts;');
    expect((await fetch(`${url}/api/conversations/${id}/files`).then(readJson)).files).toHaveLength(1);
    await writeFile(path.join(dir,'secret.txt'),'secret'); await symlink(path.join(dir,'secret.txt'),path.join(cwd,'escape.txt'));
    await writeFile(path.join(cwd,'.secret'),'hidden');
    await symlink(path.join(cwd,'.secret'),path.join(cwd,'hidden-alias.txt'));
    expect((await fetch(`${url}/api/conversations/${id}/files/raw?path=.secret`)).status).toBe(404);
    expect((await fetch(`${url}/api/conversations/${id}/files/raw?path=hidden-alias.txt`)).status).toBe(404);
    expect((await fetch(`${url}/api/conversations/${id}/files/raw?path=escape.txt`)).status).toBe(404); expect((await fetch(`${url}/api/conversations/${id}/files/raw?path=../secret.txt`)).status).toBe(404);
  });
  it('keeps workspace authority in relative preview asset URLs and rechecks each request', async () => {
    const id = await create(); const cwd = await service.ensureWorkspace(id);
    await writeFile(path.join(cwd, 'index.html'), '<link rel="stylesheet" href="style.css">');
    await writeFile(path.join(cwd, 'style.css'), 'body { color: red; }');
    const base = `${url}/api/conversations/${id}/files/content/workspace/workspace-a/member-a/`;
    const preview = await fetch(`${base}index.html`);
    expect(preview.status).toBe(200);
    const csp = preview.headers.get('content-security-policy');
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('sandbox allow-scripts;');
    expect(csp).not.toContain('allow-same-origin');
    expect(preview.headers.get('cache-control')).toBe('no-store');
    expect(await fetch(new URL('style.css', `${base}index.html`)).then((r) => r.text())).toBe('body { color: red; }');
    expect((await fetch(base.replace('/member-a/', '/member-b/') + 'index.html')).status).toBe(404);
    expect((await fetch(base.replace('/member-a/', '/removed/') + 'index.html')).status).toBe(403);
    expect((await fetch(`${base}index.html`, { headers: headers('member-b') })).status).toBe(400);
  });
  it('grants opaque-origin modules and JSON only through an authorized preview token', async () => {
    const id = await create(); const cwd = await service.ensureWorkspace(id);
    await writeFile(path.join(cwd, 'app.js'), "fetch('./data.json').then(r=>r.json());");
    await writeFile(path.join(cwd, 'data.json'), '{"value":1}');
    expect((await fetch(`${url}/api/conversations/${id}/files/preview-scope`, {headers: headers('member-b')})).status).toBe(404);
    const scope = await fetch(`${url}/api/conversations/${id}/files/preview-scope`, {headers: headers()}).then(readJson);
    expect(scope.baseUrl).toMatch(new RegExp(`/api/conversations/${id}/files/preview/[a-f0-9-]+/`));
    const module = await fetch(`${url}${scope.baseUrl}app.js`, {headers: {origin:'null'}});
    expect(module.status).toBe(200); expect(module.headers.get('access-control-allow-origin')).toBe('*');
    expect(module.headers.get('content-security-policy')).toContain(`${url}${scope.baseUrl}`);
    expect(module.headers.get('content-security-policy')).not.toContain('allow-same-origin');
    const proxied = await fetch(`${url}${scope.baseUrl}data.json`, {headers:{origin:'null'}});
    expect(proxied.headers.get('content-security-policy')).toContain(`http://127.0.0.1:45232${scope.baseUrl}`);
    expect(await fetch(`${url}${scope.baseUrl}data.json`, {headers:{origin:'null'}}).then(readJson)).toEqual({value:1});
    expect((await fetch(`${url}${scope.baseUrl}app.js`, {headers:{origin:'https://unrelated.example'}})).headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${url}/api/conversations/${id}/files/content/workspace/workspace-a/member-a/app.js`, {headers:{origin:'null'}})).headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${url}${scope.baseUrl.replace(/preview\/[^/]+\//, 'preview/unknown/')}app.js`, {headers:{origin:'null'}})).status).toBe(404);
    await fetch(`${url}/api/conversations/${id}`, {method:'DELETE',headers:headers()});
    expect((await fetch(`${url}${scope.baseUrl}app.js`, {headers:{origin:'null'}})).status).toBe(404);
  });
  it('persists metadata/messages across reopen', async () => {
    const id = await create(); upsertMessage(db,id,{id:'message',role:'user',content:'kept'});
    closeDatabase(); db = openDatabase(dir,{dataDir:dir});
    const fresh = new StandaloneConversationService({db,runtimeDataDir:dir,verifyRead:async()=>{throw new Error('unused');},verifyWrite:async()=>{throw new Error('unused');}});
    expect(fresh.get(id)?.title).toBe('Independent'); expect(listMessages(db,id)[0]?.content).toBe('kept');
  });
  it('cancels owned runs then cascades messages/scopes without deleting sibling', async () => {
    const id = await create(); const sibling = await create(); upsertMessage(db,id,{id:'message',role:'user',content:'removed'});
    const run = {id:'active'}; runs.list.mockReturnValue([run]);
    expect((await fetch(`${url}/api/conversations/${id}`,{method:'DELETE',headers:headers('member-b')})).status).toBe(404);
    expect((await fetch(`${url}/api/conversations/${id}`,{method:'DELETE',headers:headers()})).status).toBe(200);
    expect(runs.cancel).toHaveBeenCalledWith(run,'project_cleanup'); expect(listMessages(db,id)).toEqual([]); expect(service.scope(id)).toBeNull(); expect(service.get(sibling)).not.toBeNull();
  });
  it('pins AMR billing without project and refuses wrong conversation identity', async () => {
    const id = await create(); const workspaceScope = service.pinRunScope(id);
    const env = await openDesignAmrTraceEnvForRun({agentId:'amr',runId:'run',runAttempt:0,conversationId:id,projectId:null,workspaceScope}); expect(env.OPEN_DESIGN_WORKSPACE_ID).toBe('workspace-a');
    await expect(openDesignAmrTraceEnvForRun({agentId:'amr',runId:'run',runAttempt:1,conversationId:'foreign',projectId:null,workspaceScope})).rejects.toThrow();
  });
});
