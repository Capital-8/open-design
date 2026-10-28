import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { PreviewComment } from '@open-design/contracts';
import { clusterTest as test, expect } from '@/playwright/suite';
import { createCollabCluster, type CollabCluster } from '@/playwright/collab-cluster';
import { startFakeCollabHub, type FakeCollabHub } from '@/playwright/fake-collab-hub';
import { T } from '@/timeouts';
import { warmPlaywrightWebRuntime } from '@/playwright/runtime-lifecycle';

const WS = 'ws-share-mainline';
const A = { controlKey: 'ci-owner-not-a-real-key', memberId: 'ci-owner', name: 'CI Owner', role: 'owner' as const };
const B = { controlKey: 'ci-reader-not-a-real-key', memberId: 'ci-reader', name: 'CI Reader', role: 'member' as const };
let cluster: CollabCluster;
let hub: FakeCollabHub;
let startupMs = 0;
const timings: { phase: string; ms: number; outcome: 'passed' | 'failed' }[] = [];
async function measured<T>(phase: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let outcome: 'passed' | 'failed' = 'failed';
  try {
    const result = await test.step(phase, run);
    outcome = 'passed';
    return result;
  } finally { timings.push({ phase, ms: performance.now() - start, outcome }); }
}
const createFile = () => measured('seed project and four files', createFileImpl);
const openFile = (page: Page, projectId: string) => measured(`open file on ${page === cluster.clients.owner!.page ? 'owner' : 'member'}`, () => openFileImpl(page, projectId));
const teamMirror = () => measured('prepare team mirror', teamMirrorImpl);
const showComments = (page: Page) => measured('open comments', () => showCommentsImpl(page));
const comment = (page: Page, projectId: string, note: string) => measured('create comment', () => commentImpl(page, projectId, note));
const publishCurrentFile = (page: Page, projectId: string) => measured('publish current file', () => publishCurrentFileImpl(page, projectId));
let failed = false;
const browserMarker = `--od-share-mainline=${process.pid}`;
// Playwright provides a unique temporary profile and owns process cleanup.
test.use({ launchOptions: { args: ['--use-mock-keychain', browserMarker], chromiumSandbox: true }, ignoreHTTPSErrors: true, trace: 'retain-on-failure' });
test.describe.configure({ timeout: T.xlong * 3 });
const headers = (id: typeof A | typeof B) => ({
  'x-od-workspace-id': WS, 'x-od-workspace-type': 'team', 'x-od-workspace-member-id': id.memberId,
  'x-od-workspace-role': id.role, 'x-od-workspace-member-status': 'active', 'x-od-workspace-lifecycle-state': 'active',
  'x-od-workspace-can-share-projects': String(id.role === 'owner'), 'x-od-workspace-can-write-synced-files': String(id.role === 'owner'),
});
const html = (v: number) => `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><h1 data-od-id="main-title">Share mainline V${v}</h1><img id="brand" src="./brand.svg"><button id="action" onclick="this.textContent='Clicked V${v}'">Action V${v}</button><script src="./script.js"></script></body></html>`;

test.beforeAll(async ({ browser }, info) => {
  const started = performance.now();
  const root = info.outputPath('external-fixture'); await mkdir(root, { recursive: true });
  hub = await startFakeCollabHub({ root, workspaceId: WS, workspaceName: 'CI share team', clients: [A, B], publicShares: true });
  try {
    const vela = await hub.writeVelaBin(join(root, 'vela-fixture'));
    const env = { VELA_BIN: vela, VELA_API_URL: hub.url, VELA_PROFILE: 'local', OPEN_DESIGN_AMR_PROFILE: 'local', OD_COLLAB_TRANSPORT: 'vela-cli', OD_RESOURCE_TRANSPORT: 'vela-cli', OD_TEAM_PROJECTS_TRANSPORT: 'vela-cli', OD_WORKSPACE_CONTEXT_SOURCE: 'vela' };
    cluster = await createCollabCluster(browser, info, [
      { id: 'owner', env: { ...env, VELA_CONTROL_KEY: A.controlKey, AMR_HOME: join(root, 'owner-amr') } },
      { id: 'reader', env: { ...env, VELA_CONTROL_KEY: B.controlKey, AMR_HOME: join(root, 'reader-amr') } },
    ]);
    for (const [name, id] of [['owner', A], ['reader', B]] as const) {
      const page = cluster.clients[name]!.page;
      await page.addInitScript(() => {
        localStorage.setItem('open-design:locale', 'en'); localStorage.setItem('open-design:locale-source', 'manual');
      });
      const configured = await page.request.put('/api/app-config', { data: { onboardingCompleted: true, mode: 'byok', agentId: 'opencode', model: '', keyScope: 'local', liteLlmBaseUrl: '', liteLlmApiKey: '' } });
      expect(configured.ok(), await configured.text()).toBeTruthy();
      const pinned = await page.request.put('/api/workspace/active', { data: { workspaceId: WS, workspaceMemberId: id.memberId } });
      expect(pinned.ok(), await pinned.text()).toBeTruthy();
    }
    // Compile each isolated server's immutable UI shell concurrently. This is
    // inside the measured lifecycle and shares no browser or daemon state.
    await Promise.all(Object.values(cluster.clients).map(client => warmPlaywrightWebRuntime(client.runtime.url.web('/'))));
    startupMs = performance.now() - started;
    await info.attach('runtime-startup', { body: JSON.stringify({ startupMs, browserVersion: browser.version(), browserMarker, mode: 'real OD Web+daemon; temporary fake Vela/AMR; fixture public receiver, not production Viewer', clients: Object.values(cluster.clients).map(c => ({ id: c.id, namespace: c.runtime.namespace, dataDir: c.runtime.dataDir, webUrl: c.runtime.webUrl, daemonUrl: c.runtime.daemonUrl })) }), contentType: 'application/json' });
  } catch (error) { await cluster?.close({ preserve: true }); await hub.close(); throw error; }
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) failed = true;
  await info.attach('phase-timings', { body: JSON.stringify(timings.splice(0)), contentType: 'application/json' });
  await info.attach('fixture-boundary', { body: JSON.stringify({ startupMs, commands: hub.commandLog, requests: hub.requestLog, boundary: 'No real AMR API/DB/Vela CLI/Viewer/package validation. Both comment endpoints are real isolated OD clients.' }), contentType: 'application/json' });
});
test.afterAll(async () => { try { await cluster?.close({ preserve: failed }); } finally { await hub?.close(); } });

async function createFileImpl() {
  const page = cluster.clients.owner!.page; const projectId = `share-core-${randomUUID()}`;
  const created = await page.request.post('/api/projects', { headers: headers(A), data: { id: projectId, name: 'Share mainline', skillId: null, designSystemId: null, metadata: { kind: 'prototype', nameSource: 'user' } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = await created.json();
  for (const [name, content] of [['index.html', html(1)], ['style.css', 'h1{color:rgb(18,52,86)}'], ['script.js', 'document.body.dataset.scriptReady="yes"'], ['brand.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>']]) {
    const file = await page.request.post(`/api/projects/${projectId}/files`, { headers: headers(A), data: { name, content, ...(name === 'index.html' ? { artifactManifest: { version: 1, kind: 'html', title: 'Share mainline', entry: 'index.html', renderer: 'html', exports: ['html'] } } : {}) } });
    expect(file.ok(), await file.text()).toBeTruthy();
  }
  return { page, projectId, conversationId: body.conversationId as string };
}
async function openFileImpl(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/files/index.html`, { waitUntil: 'domcontentloaded', timeout: T.xlong });
  await expect(page.getByTestId('file-workspace')).toBeVisible({ timeout: T.xlong });
}
async function shareMenu(page: Page) {
  await page.getByTestId('file-workspace').getByRole('button', { name: 'Share', exact: true }).click();
  const menu = page.locator('.share-menu-popover[role="menu"]'); await expect(menu).toBeVisible(); return menu;
}
async function publishCurrentFileImpl(page: Page, projectId: string) {
  const menu = await shareMenu(page);
  const action = menu.getByRole('menuitem').filter({ hasText: /Generate and copy|生成并复制/ });
  await expect(action, 'share history must be readable before publish').toBeEnabled({ timeout: T.long });
  const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/api/projects/${projectId}/files/index.html/publish-public`), { timeout: T.long }), action.click()]); expect(response.ok(), await response.text()).toBeTruthy();
  const json = await response.json(); const url = json.url as string;
  expect(url).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/artifact\//);
  await expect(menu.locator('.chrome-publish-url')).toHaveText(url);
  return { menu, url, receipt: json.receipt };
}

// Three independent workflows retain all six capability checkpoints. Lifecycle
// transitions reuse their own prerequisite publication, never another test's data.
test('[P0] MAIN-01/02/03 public share lifecycle', async ({ browser }, info) => {
  const { page, projectId } = await createFile();
  await openFile(page, projectId);
  const { url, menu } = await publishCurrentFile(page, projectId);
  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const receiver = await anonymous.newPage();
    await measured('MAIN-01 publish and receive local image/CSS/JS', async () => {
      expect(await anonymous.cookies()).toHaveLength(0);
      await receiver.goto(url); await expect(receiver.getByRole('heading')).toHaveText('Share mainline V1');
      await expect(receiver.getByRole('heading')).toHaveCSS('color', 'rgb(18, 52, 86)');
      await expect(receiver.locator('body')).toHaveAttribute('data-script-ready', 'yes');
      await expect.poll(() => receiver.locator('#brand').evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(24);
      await receiver.getByRole('button', { name: 'Action V1' }).click(); await expect(receiver.getByRole('button')).toHaveText('Clicked V1');
      await receiver.reload(); await expect(receiver.getByRole('heading')).toHaveText('Share mainline V1');
      const denied = await anonymous.request.get(`${hub.publicOrigin}/api/projects/${projectId}`); expect(denied.status()).toBe(404);
      await info.attach('receiver', { body: await receiver.screenshot(), contentType: 'image/png' });
    });
    await measured('MAIN-02 update preserves original URL and delivers V2', async () => {
      const saved = await page.request.post(`/api/projects/${projectId}/files`, { headers: headers(A), data: { name: 'index.html', content: html(2) } }); expect(saved.ok()).toBeTruthy();
      const updated = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/files/index.html/publish-public`), { timeout: T.long });
      await menu.getByRole('button', { name: /Update link|更新链接/ }).click();
      const response = await updated; expect(response.ok(), await response.text()).toBeTruthy(); expect((await response.json()).url).toBe(url);
      await receiver.goto(url); await expect(receiver.getByRole('heading')).toHaveText('Share mainline V2');
      await receiver.getByRole('button').click(); await expect(receiver.getByRole('button')).toHaveText('Clicked V2');
    });
    await measured('MAIN-03 stop and resume the same URL', async () => {
      const stopped = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().endsWith('/publish-public'));
      await menu.getByRole('switch').click(); const stop = await stopped; expect(stop.ok(), await stop.text()).toBeTruthy();
      expect((await receiver.goto(url))?.status()).toBe(410);
      const resumed = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/publish-public'));
      await menu.getByRole('switch').click(); const resume = await resumed; expect(resume.ok(), await resume.text()).toBeTruthy(); expect((await resume.json()).url).toBe(url);
      await receiver.goto(url); await expect(receiver.getByRole('heading')).toHaveText('Share mainline V2');
    });
  } finally { await anonymous.close(); }
});

async function teamMirrorImpl() {
  const file = await createFile();
  const moved = await file.page.request.post(`/api/workspaces/${WS}/projects/${file.projectId}/move`, { headers: headers(A), data: { visibility: 'team' }, timeout: T.long }); expect(moved.ok(), await moved.text()).toBeTruthy();
  const member = cluster.clients.reader!.page;
  const listed = await member.request.get('/api/workspace/projects/team', { headers: headers(B) }); expect(listed.ok(), await listed.text()).toBeTruthy();
  // Independent clients can load the already committed team snapshot together.
  await Promise.all([openFile(member, file.projectId), openFile(file.page, file.projectId)]);
  await expect(member.frameLocator('iframe:visible').first().getByRole('heading', { name: 'Share mainline V1' })).toBeVisible({ timeout: T.long });
  return { ...file, member };
}
async function showCommentsImpl(page: Page) {
  // Comments owns both mode activation and panel opening. Clicking Comment
  // first changes toolbar geometry; an immediate second click can hit the
  // pre-commit layout. One owning action plus committed state avoids that race.
  const toggle = page.getByTestId('comment-panel-toggle');
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('comment-side-panel')).toBeVisible();
}
async function commentImpl(page: Page, projectId: string, note: string) {
  // teamMirror already opened both clients on this project/file. Actions must
  // not navigate again: the app may canonicalize the URL after loading.
  await showComments(page);
  const frame = page.frameLocator('iframe:visible').first();
  await expect(frame.locator('html[data-od-comment-mode]'), 'comment bridge must consume host mode before selection').toHaveCount(1, { timeout: T.medium });
  await frame.locator('h1').click();
  await page.getByTestId('comment-popover-input').fill(note);
  const submitted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith(`/api/projects/${projectId}/conversations/`) && /\/comments$/.test(new URL(r.url()).pathname));
  await page.getByTestId('comment-popover-save').click(); const response = await submitted;
  expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).comment as PreviewComment;
}
test('[P0] MAIN-04/05 bidirectional comments survive reopen', async ({}, info) => {
  const { page, member, projectId } = await teamMirror();
  for (const direction of ['web-to-client', 'client-to-web'] as const) {
    await measured(`${direction === 'web-to-client' ? 'MAIN-04' : 'MAIN-05'} ${direction} same comment survives reopen`, async () => {
      const sender = direction === 'web-to-client' ? member : page; const receiver = direction === 'web-to-client' ? page : member;
      await Promise.all([showComments(receiver), showComments(sender)]);
      const accepted = await comment(sender, projectId, `${direction}-${randomUUID()}`);
      const author = direction === 'web-to-client' ? B : A;
      expect(accepted.authorMemberId).toBe(author.memberId); expect(accepted.elementId).toBe('main-title'); expect(accepted.sourceFileId).toBeTruthy();
      const row = receiver.getByTestId('comment-side-item').filter({ hasText: accepted.note });
      await expect(row).toBeVisible({ timeout: T.long }); await expect(row).toHaveAttribute('data-comment-id', accepted.id); await expect(row).toHaveCount(1);
      await receiver.reload(); await showComments(receiver); await expect(row).toBeVisible({ timeout: T.long }); await expect(row).toHaveAttribute('data-comment-id', accepted.id); await expect(row).toHaveCount(1);
      await expect(row).toContainText(author.name);
      const receiverIdentity = direction === 'web-to-client' ? A : B;
      const conversations = await receiver.request.get(`/api/projects/${projectId}/conversations`, { headers: headers(receiverIdentity) });
      expect(conversations.ok()).toBeTruthy();
      const receiverConversation = (await conversations.json()).conversations[0].id as string;
      const read = await receiver.request.get(`/api/projects/${projectId}/conversations/${receiverConversation}/comments`, { headers: headers(receiverIdentity) });
      expect(read.ok()).toBeTruthy();
      const received = ((await read.json()).comments as PreviewComment[]).filter(c => c.id === accepted.id);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: accepted.id, note: accepted.note, authorMemberId: author.memberId, sourceFileId: accepted.sourceFileId, elementId: accepted.elementId, selector: accepted.selector, filePath: 'index.html' });
      await info.attach(`${direction}-comment-identity`, { body: JSON.stringify({ projectId, direction, accepted, received }), contentType: 'application/json' });
      await info.attach(`${direction}-comment-receiver`, { body: await receiver.screenshot(), contentType: 'image/png' });
    });
  }
});

test('[P0] MAIN-06 read-only member cannot publish or update', async ({}) => {
  const { page, member, projectId } = await teamMirror();
  const before = hub.commandLog.filter(c => c.args[0] === 'share' && c.args[1] === 'publish').length;
  const ui = member.getByTestId('file-workspace').getByRole('button', { name: 'Share', exact: true });
  if (await ui.isEnabled()) { await ui.click(); await expect(member.locator('.share-menu-popover')).not.toContainText('Generate and copy link'); } else await expect(ui).toBeDisabled();
  const denied = await member.request.post(`/api/projects/${projectId}/files/index.html/publish-public`, { headers: headers(B), data: {} }); expect(denied.status()).toBe(403);
  const ownerPublished = await publishCurrentFile(page, projectId);
  const updateDenied = await member.request.post(`/api/projects/${projectId}/files/index.html/publish-public`, { headers: headers(B), data: {} }); expect(updateDenied.status()).toBe(403);
  expect(hub.commandLog.filter(c => c.args[0] === 'share' && c.args[1] === 'publish').length).toBe(before + 1);
  const ownerState = await page.request.get(`/api/projects/${projectId}/files/index.html/publish-public`, { headers: headers(A) });
  expect(ownerState.ok()).toBeTruthy(); expect((await ownerState.json()).publication.url).toBe(ownerPublished.url);
});
