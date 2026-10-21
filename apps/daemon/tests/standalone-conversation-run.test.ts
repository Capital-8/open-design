import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

type Started = { url:string; server:Server; shutdown?:()=>Promise<void>|void };
async function readJson(response: Response): Promise<Record<string, any>> { return await response.json() as Record<string, any>; }
describe('standalone conversation real HTTP/runtime lifecycle', () => {
  let started: Started | null = null; let dir: string | null = null;
  const originalEnv = {...process.env};
  afterEach(async () => {
    await started?.shutdown?.();
    if (started) await new Promise<void>((resolve)=>started!.server.close(()=>resolve()));
    started=null;
    if(dir) await rm(dir,{recursive:true,force:true}); dir=null;
    for(const key of Object.keys(process.env)) if(!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env,originalEnv);
  });
  it('creates without project, sends two persisted turns in the same cwd, reads files/SSE and reopens after daemon restart', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(),'od-standalone-run-'));
    const home=path.join(dir,'agent-home'); await mkdir(home);
    const script=path.join(dir,'fixture.cjs'); const bin=path.join(dir,'codex-fixture');
    await writeFile(script, `const fs=require('node:fs');const args=process.argv.slice(2);
      if(args.includes('--version')){console.log('codex-cli 0.143.0');process.exit(0);}
      if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit(0);}
      const input=fs.readFileSync(0,'utf8'); fs.writeFileSync('agent-input.txt',JSON.stringify(args)+'\\n'+input);
      const previous=fs.existsSync('index.html')?fs.readFileSync('index.html','utf8'):'';
      const count=(previous.match(/turn/g)||[]).length+1;
      fs.writeFileSync('index.html','<!doctype html><html><body>'+('turn '.repeat(count))+'</body></html>');
      fs.writeFileSync('cwd.txt',process.cwd());
      console.log(JSON.stringify({type:'thread.started',thread_id:'019f0000-0000-7000-8000-000000000001'}));
      console.log(JSON.stringify({type:'turn.started'}));
      console.log(JSON.stringify({type:'item.completed',item:{id:'reply-'+count,type:'agent_message',text:'Created index.html, turn '+count}}));
      console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:0,output_tokens:5}}));
      setTimeout(()=>process.exit(0),20);`);
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${script.replaceAll("'","'\\''")}' "$@"\n`); await chmod(bin,0o755);
    for(const key of Object.keys(process.env)) if(/^(LANGFUSE_|POSTHOG_|OPENAI_|CODEX_API_KEY$|OPEN_DESIGN_TELEMETRY_RELAY_URL$)/i.test(key)) delete process.env[key];
    process.env.OD_CODEX_TRANSPORT='exec-json'; process.env.OD_NEXT_STRATEGY_ROLLOUT='off';
    started=await startServer({port:0,returnServer:true}) as Started;
    const jsonHeaders={'content-type':'application/json'};
    const config=await fetch(`${started.url}/api/app-config`,{method:'PUT',headers:jsonHeaders,body:JSON.stringify({agentId:'codex',agentCliEnv:{codex:{CODEX_BIN:bin,CODEX_HOME:home}},telemetry:{metrics:false,content:false,artifactManifest:false},privacyDecisionAt:Date.now()})}); expect(config.status).toBe(200);
    const cli = async (...args: string[]) => {
      const { stdout } = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url)),
        fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
        ...args, '--daemon-url', started!.url, '--json',
      ], { env: process.env, timeout: 15_000 });
      return JSON.parse(stdout);
    };
    const installation = await fetch(`${started.url}/api/plugins/install`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source: fileURLToPath(new URL('./fixtures/plugin-fixtures/sample-plugin', import.meta.url)) }) });
    expect(installation.status).toBe(200);
    expect(await installation.text()).toContain('sample-plugin');
    const projectsBefore=await fetch(`${started.url}/api/projects`).then(readJson);
    const created=await fetch(`${started.url}/api/conversations`,{method:'POST',headers:jsonHeaders,body:JSON.stringify({title:'Independent',sessionMode:'chat'})}); expect(created.status).toBe(201);
    const conversation=(await readJson(created)).conversation; expect(conversation.projectId).toBeNull();
    let appliedSnapshotId: string | undefined;
    for(let turn=1;turn<=2;turn++) {
      const response=await fetch(`${started.url}/api/runs`,{method:'POST',headers:jsonHeaders,body:JSON.stringify({conversationId:conversation.id,projectId:null,agentId:'codex',model:'default',sessionMode:'design',pluginId: turn === 1 ? 'sample-plugin' : undefined,pluginInputs:{topic:'standalone prototype'},appliedPluginSnapshotId: appliedSnapshotId,message:`Make turn ${turn}`,currentPrompt:`Make turn ${turn}`})});
      const createBody=await readJson(response); expect(response.status,JSON.stringify(createBody)).toBe(202);
      expect(createBody.appliedPluginSnapshotId).toBeTruthy();
      appliedSnapshotId = createBody.appliedPluginSnapshotId;
      let status:any;
      for(let retry=0;retry<100;retry++) {status=await fetch(`${started.url}/api/runs/${createBody.runId}`).then(readJson);if(['failed','succeeded','canceled'].includes(status.status))break;await new Promise(r=>setTimeout(r,100));}
      expect(status.status,JSON.stringify(status)).toBe('succeeded'); expect(status.projectId).toBeNull();
      expect(status.pluginId).toBe('sample-plugin');
      const prompt = await fetch(`${started.url}/api/conversations/${conversation.id}/files/raw?path=agent-input.txt`).then((r) => r.text());
      if (turn === 1) expect(prompt).toContain('Sample Plugin');
      expect((await fetch(`${started.url}/api/applied-plugins/${appliedSnapshotId}`).then(readJson)).pluginId).toBe('sample-plugin');
      const events=await fetch(`${started.url}/api/runs/${createBody.runId}/events`).then(r=>r.text()); expect(events).toContain('Created index.html');
      const file=await fetch(`${started.url}/api/conversations/${conversation.id}/files/raw?path=index.html`).then(r=>r.text()); expect((file.match(/turn/g)||[])).toHaveLength(turn);
    }
    const promptFile = path.join(dir, 'prompt.txt');
    await writeFile(promptFile, 'Continue through the CLI\nKeep the existing file');
    const cliRun = await cli('run', 'start', '--conversation', conversation.id, '--agent', 'codex', '--prompt-file', promptFile);
    let cliStatus: any;
    for (let retry = 0; retry < 100; retry++) {
      cliStatus = await fetch(`${started.url}/api/runs/${cliRun.runId}`).then(readJson);
      if (['failed', 'succeeded', 'canceled'].includes(cliStatus.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(cliStatus.status, JSON.stringify(cliStatus)).toBe('succeeded');
    expect(cliStatus.appliedPluginSnapshotId).toBe(appliedSnapshotId);
    expect((await cli('run', 'list', '--conversation', conversation.id)).runs.map((run: any) => run.id)).toContain(cliRun.runId);
    expect((await cli('conversation', 'info', conversation.id)).conversation.projectId).toBeNull();
    expect((await cli('conversation', 'rename', conversation.id, '--title', 'Renamed from CLI')).conversation.title).toBe('Renamed from CLI');
    expect((await cli('conversation', 'files', conversation.id)).files.some((file: any) => file.name === 'index.html')).toBe(true);
    const preview = await cli('conversation', 'files', conversation.id, '--preview', '--path', 'index.html');
    const opaquePreview = await fetch(preview.url, { headers: { origin: 'null' } });
    expect(opaquePreview.status).toBe(200);
    expect(opaquePreview.headers.get('access-control-allow-origin')).toBe('*');
    process.env.OD_WEB_PORT = '45232';
    const splitOriginPreview = await fetch(preview.url, { headers: { origin: 'null' } });
    expect(splitOriginPreview.headers.get('content-security-policy')).toContain(`http://127.0.0.1:45232${new URL(preview.url).pathname.replace(/index\.html$/, '')}`);
    expect((await fetch(`${started.url}/api/conversations/${conversation.id}/messages`, {headers:{origin:'null'}})).status).toBe(403);
    expect((await fetch(`${started.url}/api/conversations/${conversation.id}/files/preview-scope`, {headers:{origin:'null'}})).status).toBe(403);
    const downloaded = path.join(dir, 'download.html');
    await cli('conversation', 'files', conversation.id, '--path', 'index.html', '--out', downloaded);
    expect(await readFile(downloaded, 'utf8')).toContain('turn turn turn');
    const upload = await cli('conversation', 'upload', conversation.id, '--path', promptFile);
    expect(upload.files).toHaveLength(1);
    const disposable = await cli('conversation', 'new', '--standalone', '--title', 'Disposable');
    expect(disposable.conversation.projectId).toBeNull();
    expect((await cli('conversation', 'list', '--standalone')).conversations.map((item: any) => item.id)).toContain(disposable.conversation.id);
    const foreignSnapshot = await fetch(`${started.url}/api/runs`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ conversationId: disposable.conversation.id, appliedPluginSnapshotId: appliedSnapshotId, agentId: 'codex', message: 'Cannot borrow another conversation snapshot' }) });
    expect(foreignSnapshot.status).toBe(404);
    await cli('conversation', 'delete', disposable.conversation.id);
    expect((await fetch(`${started.url}/api/conversations/${disposable.conversation.id}`)).status).toBe(404);
    for (const [pluginId, pluginInputs] of [
      ['example-web-prototype', {}],
      ['od-new-generation', { artifactKind: 'motion design', audience: 'product users', topic: 'opening animation' }],
    ] as const) {
      const taskConversation = (await cli('conversation', 'new', '--standalone', '--title', pluginId)).conversation;
      const response = await fetch(`${started.url}/api/runs`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({
        conversationId: taskConversation.id, sessionMode: 'design', agentId: 'codex', pluginId, pluginInputs,
        message: 'Create the selected task',
      }) });
      const task = await readJson(response); expect(response.status, JSON.stringify(task)).toBe(202);
      let status: any;
      for (let retry = 0; retry < 100; retry++) {
        status = await fetch(`${started.url}/api/runs/${task.runId}`).then(readJson);
        if (['failed', 'succeeded', 'canceled'].includes(status.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(status.status, JSON.stringify(status)).toBe('succeeded');
      const snapshot = await fetch(`${started.url}/api/applied-plugins/${task.appliedPluginSnapshotId}`).then(readJson);
      expect(snapshot.pluginId).toBe(pluginId);
      const actualPrompt = await fetch(`${started.url}/api/conversations/${taskConversation.id}/files/raw?path=agent-input.txt`).then((r) => r.text());
      expect(actualPrompt).toContain(pluginId);
    }
    const inactiveStrategy = await fetch(`${started.url}/api/runs`, { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ conversationId: conversation.id, agentId: 'codex', pluginId: 'od-next-strategy', message: 'Do not bypass internal admission' }) });
    expect([404,409]).toContain(inactiveStrategy.status);
    const cwd=await fetch(`${started.url}/api/conversations/${conversation.id}/files/raw?path=cwd.txt`).then(r=>r.text());
    expect(cwd.startsWith(await realpath(process.env.OD_DATA_DIR!)+path.sep)).toBe(true); expect(cwd).not.toContain(`${path.sep}projects${path.sep}`);
    const messages=await fetch(`${started.url}/api/conversations/${conversation.id}/messages`).then(readJson);
    expect(messages.messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual(['Make turn 1','Make turn 2','Continue through the CLI\nKeep the existing file']);
    expect(messages.messages.filter((m:any)=>m.role==='assistant')).toHaveLength(3);
    expect((await fetch(`${started.url}/api/projects`).then(readJson)).projects).toEqual(projectsBefore.projects);
    await started.shutdown?.(); await new Promise<void>(resolve=>started!.server.close(()=>resolve())); started=null;
    started=await startServer({port:0,returnServer:true}) as Started;
    expect((await fetch(`${started.url}/api/conversations/${conversation.id}/messages`).then(readJson)).messages).toHaveLength(6);
    expect(await fetch(`${started.url}/api/conversations/${conversation.id}/files/raw?path=cwd.txt`).then(r=>r.text())).toBe(cwd);
    expect(await readFile(path.join(cwd,'index.html'),'utf8')).toContain('turn turn');
  },90_000);
});
