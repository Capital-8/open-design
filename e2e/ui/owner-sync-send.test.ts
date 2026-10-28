import { randomUUID } from 'node:crypto';
import { createCollabCluster, type CollabCluster } from '@/playwright/collab-cluster';
import { startFakeCollabHub } from '@/playwright/fake-collab-hub';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { clusterTest as test, expect } from '@/playwright/suite';
import { T } from '@/timeouts';

test('[P1] OPEND-4492 owner replacement holds send until synchronization completes and keeps the unsent draft', async ({ browser }, testInfo) => {
  test.setTimeout(T.xlong);
  const workspaceId = 'ws-owner-sync-send';
  const owner = { controlKey: 'owner-sync-send-key', memberId: 'owner-sync-send', name: 'Owner', role: 'owner' as const };
  let holdPull = false;
  let pullStarted = false;
  let release!: () => void;
  const pullGate = new Promise<void>(resolve => { release = resolve; });
  const hub = await startFakeCollabHub({
    root: testInfo.outputPath('hub'), workspaceId, workspaceName: 'Owner sync', clients: [owner],
    beforeCommand: async ({ args }) => {
      if (holdPull && args[0] === 'resource' && args[1] === 'pull' && args[2] === 'project') {
        pullStarted = true;
        await pullGate;
      }
    },
  });
  const velaBin = await hub.writeVelaBin(testInfo.outputPath('vela'));
  const env = { OD_COLLAB_TRANSPORT: 'vela-cli', OD_RESOURCE_TRANSPORT: 'vela-cli', OD_TEAM_PROJECTS_TRANSPORT: 'vela-cli', OD_WORKSPACE_CONTEXT_SOURCE: 'vela', VELA_API_URL: hub.url, VELA_BIN: velaBin, VELA_CONTROL_KEY: owner.controlKey, AMR_HOME: testInfo.outputPath('empty-amr-home') };
  const headers = { 'x-od-workspace-id': workspaceId, 'x-od-workspace-member-id': owner.memberId, 'x-od-workspace-type': 'team', 'x-od-workspace-role': 'owner', 'x-od-workspace-member-status': 'active', 'x-od-workspace-lifecycle-state': 'active', 'x-od-workspace-can-share-projects': 'true', 'x-od-workspace-can-write-synced-files': 'true' };
  const id = randomUUID();
  let cluster: CollabCluster | undefined;
  let failed = false;
  try {
    cluster = await createCollabCluster(browser, testInfo, [{ id: 'a', env }, { id: 'b', env }]);
    const a = cluster.clients.a!.page;
    const b = cluster.clients.b!.page;
    for (const page of [a, b]) {
      await applyStandardMocks(page);
      const pin = await page.request.put('/api/workspace/active', { data: { workspaceId, workspaceMemberId: owner.memberId } });
      expect(pin.ok(), await pin.text()).toBeTruthy();
      await page.request.get(`/api/workspace/billing?scope=workspace&workspaceId=${workspaceId}`, { headers });
    }
    const created = await a.request.post('/api/projects', { headers, data: { id, name: 'Owner synchronization admission', skillId: null, designSystemId: null, metadata: { kind: 'prototype' } } });
    expect(created.ok(), await created.text()).toBeTruthy();
    async function write(content: string) {
      const response = await a.request.post(`/api/projects/${id}/files`, { headers, data: { name: 'index.html', content: `<!doctype html><html><body>${content}</body></html>` } });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    await write('Initial content');
    const shared = await a.request.post(`/api/workspaces/${workspaceId}/projects/${id}/move`, { headers, data: { visibility: 'team' } });
    expect(shared.ok(), await shared.text()).toBeTruthy();
    await expect.poll(async () => {
      const response = await b.request.get(`/api/projects/${id}/collab/status`, { headers });
      return response.ok() && !(await response.json()).awaitingFirstMaterialization;
    }, { timeout: T.long }).toBe(true);
    await b.goto(`/projects/${id}/files/index.html`);
    const composer = b.getByTestId('chat-composer-input');
    const send = b.getByTestId('chat-send');
    const draft = 'Keep this draft while the cloud version replaces the files';
    await composer.fill(draft);
    await expect(send).toBeEnabled();
    const runs: string[] = [];
    b.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs.push(request.url());
    });
    await write('Replacement content');
    const published = await a.request.post(`/api/projects/${id}/collab/publish`, { headers });
    expect(published.ok(), await published.text()).toBeTruthy();
    const dialog = b.getByRole('alertdialog', { name: 'Updates on another device' });
    await expect(dialog).toBeVisible({ timeout: T.long });
    holdPull = true;
    await dialog.getByRole('button', { name: 'Sync and overwrite' }).click();
    await expect.poll(() => pullStarted, { timeout: T.medium, message: 'replacement reaches native resource download' }).toBe(true);
    await expect(dialog).toHaveCount(0, { timeout: T.long });
    const status = await b.request.get(`/api/projects/${id}/collab/status`, { headers });
    const during = (await status.json()).ownedContentUpdate;
    expect(during.state).toBe('downloading');
    await expect(b.getByTestId('owned-content-update').getByRole('button', { name: 'Syncing…', exact: true })).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(composer).toHaveText(draft);
    await b.screenshot({ path: testInfo.outputPath('owner-sync-send-blocked.png'), animations: 'disabled' });
    await testInfo.attach('Sync holds send and preserves draft', { path: testInfo.outputPath('owner-sync-send-blocked.png'), contentType: 'image/png' });
    holdPull = false;
    release();
    await expect(send).toBeEnabled({ timeout: T.long });
    await expect(composer).toHaveText(draft);
    const content = await b.request.get(`/api/projects/${id}/raw/index.html`, { headers });
    expect(await content.text()).toContain('Replacement content');
    expect(runs).toEqual([]);
    const completed = await b.request.get(`/api/projects/${id}/collab/status`, { headers });
    const after = (await completed.json()).ownedContentUpdate;
    expect(after.state).toBe('up_to_date');
    expect(after.localVersion).toBe(after.latestVersion);
    await testInfo.attach('Owner sync admission evidence', {
      body: JSON.stringify({ projectId: id, workspaceId, during, after, unsentDraft: draft, runRequests: runs }, null, 2),
      contentType: 'application/json',
    });
    await b.screenshot({ path: testInfo.outputPath('owner-sync-send-restored.png'), animations: 'disabled' });
    await testInfo.attach('Sync completes without automatically sending the draft', { path: testInfo.outputPath('owner-sync-send-restored.png'), contentType: 'image/png' });
  } catch (error) { failed = true; throw error; }
  finally { release(); await cluster?.close({ preserve: failed }); await hub.close(); }
});
