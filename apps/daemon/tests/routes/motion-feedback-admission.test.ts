import type { Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';

let started: { server: Server; url: string; shutdown?: () => Promise<void> | void } | undefined;
afterEach(async () => {
  await started?.shutdown?.();
  if (started?.server.listening) await new Promise<void>(resolve => started!.server.close(() => resolve()));
  started = undefined;
});

it('rejects screenshot-less time feedback on both public run entrypoints before creating a task', async () => {
  started = await startServer({ port: 0, returnServer: true }) as NonNullable<typeof started>;
  const feedback = { id: 'review', filePath: 'index.html', elementId: 'title', selector: '#title',
    motion: { timeSeconds: 2.4, durationSeconds: 8, sourceFingerprint: 'source-123' } };
  for (const endpoint of ['/api/runs', '/api/chat']) {
    const response = await fetch(`${started.url}${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'not-created', message: 'Edit title', commentAttachments: [feedback] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST', message: 'Motion feedback requires a project image screenshot' } });
  }
});
