import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function cli(args: string[], stdin = ''): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, [resolve('../../node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts'), 'motion', ...args], { env: { ...process.env, NODE_OPTIONS: '' } });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => done({ code, stdout, stderr })); child.stdin.end(stdin);
  });
}
describe('od motion', () => {
  it('dispatches without TDZ and sends inspect/edit through the shared API, including stdin and identity', async () => {
    const calls: { url: string; body: unknown; workspace?: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
        calls.push({ url: req.url!, body: JSON.parse(body), workspace: req.headers['x-od-workspace-id'] as string });
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ supported: false, reason: 'fixture' }));
      });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const inspect = await cli(['inspect', 'project', '--file', 'index.html', '--daemon-url', base, '--json']);
      expect(inspect.code, inspect.stderr).toBe(0); expect(JSON.parse(inspect.stdout).supported).toBe(false);
      const edit = await cli(['edit', 'project', '--file', 'index.html', '--revision', 'rev', '--prompt-file', '-', '--daemon-url', base, '--workspace', 'ws', '--workspace-member', 'member', '--json'], '{"schemaVersion":1}');
      expect(edit.code, edit.stderr).toBe(0);
      const preview = await cli(['preview', 'project', '--file', 'index.html', '--revision', 'rev', '--prompt-file', '-', '--daemon-url', base, '--json'], '{"schemaVersion":1}');
      expect(preview.code, preview.stderr).toBe(0);
      expect(calls).toEqual([
        { url: '/api/projects/project/motion/editor/read', body: { filePath: 'index.html' }, workspace: undefined },
        { url: '/api/projects/project/motion/editor/save', body: { filePath: 'index.html', baseRevision: 'rev', document: { schemaVersion: 1 } }, workspace: 'ws' },
        { url: '/api/projects/project/motion/editor/preview', body: { filePath: 'index.html', baseRevision: 'rev', document: { schemaVersion: 1 } }, workspace: undefined },
      ]);
    } finally { await new Promise<void>(done => server.close(() => done())); }
  }, 20000);
  it('rejects missing revision and invalid JSON without making edits', async () => {
    expect((await cli(['edit', 'project', '--file', 'index.html'])).code).toBe(2);
    expect((await cli(['edit', 'project', '--file', 'index.html', '--revision', 'rev', '--prompt-file', '-'], 'not json')).code).toBe(2);
  }, 20000);
});
