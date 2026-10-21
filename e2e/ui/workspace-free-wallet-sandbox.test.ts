import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BrowserContext } from '@playwright/test';
import { clusterTest as test, expect } from '@/playwright/suite';
import { seedCampaignDismissals } from '@/playwright/campaign-dismissals';
import { startFundingClient } from '@/playwright/workspace-funding-client';
import { fundingHeaders, readFundingFixture } from '@/playwright/workspace-funding-fixture';
import { readFreeWalletProof } from '@/playwright/workspace-free-wallet-fixture';
import { verifyFundingLease } from '@/playwright/workspace-funding-lease';
import { T } from '@/timeouts';

test.use({ video: 'on', viewport: { width: 1280, height: 800 } });

test('[P0] VIEW-021 actual Free gift and retained funds survive original-gift expiry with canonical console qualification', async ({ browser }, info) => {
  test.setTimeout(T.xlong * 9);
  const fixture = await readFundingFixture();
  const proof = await readFreeWalletProof(fixture);
  const wallets = fixture.freeWallet!;
  const attemptId = randomUUID();
  const evidence = join(process.env.OD_FUNDING_EVIDENCE_DIR!, `view021-${attemptId}`);
  await mkdir(evidence, { mode: 0o700 });
  const beforeDir = join(evidence, 'before');
  await mkdir(beforeDir, { mode: 0o700 });
  const expiryDir = join(evidence, 'expiry');
  await mkdir(expiryDir, { mode: 0o700 });
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const contexts: BrowserContext[] = [];
  type ConsoleRead = { path: string; status: number; body: { workspaceId?: string; workspaceMemberId?: string; wallet?: { balanceUsd?: string } } };
  const clients: Array<{ snapshots: ConsoleRead[]; pending: Promise<void>[]; alias: 'retained' | 'giftOnly'; client: Awaited<ReturnType<typeof startFundingClient>>; page: Awaited<ReturnType<BrowserContext['newPage']>>; console: Awaited<ReturnType<BrowserContext['newPage']>> }> = [];
  const observations: unknown[] = [];
  const frozenBefore: Array<{ path: string; sha256: string }> = [];
  let expiryExecuted = false;
  let bodyCompleted = false;
  const readPrivate = async (path: string, expectedHash: string) => {
    const s = await stat(path);
    expect(s.isFile() && (s.mode & 0o077) === 0, 'Owned private session/provenance required').toBe(true);
    const bytes = await readFile(path);
    expect(hash(bytes)).toBe(expectedHash);
    return JSON.parse(bytes.toString('utf8'));
  };
  const consoleSource = await readPrivate(wallets.consoleUi.proofPath, wallets.consoleUi.proofSha256);
  await info.attach('VIEW021-canonical-console-source', { body: JSON.stringify({ phase1Enabled: wallets.consoleUi.phase1Enabled,
    consoleSource, boundary: 'Only an actual canonical served seats-console-page can satisfy console acceptance; legacy is diagnostic' }, null, 2), contentType: 'application/json' });
  try {
    for (const alias of ['retained', 'giftOnly'] as const) {
      const wallet = wallets[alias];
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: info.outputPath(`video-${alias}`) } });
      contexts.push(context);
      await seedCampaignDismissals(context);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return !url.protocol.startsWith('http') || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
          ? route.continue() : route.abort();
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const cookies = await readPrivate(wallet.consoleCookiesPath, wallet.consoleCookiesSha256);
      expect(Array.isArray(cookies) && cookies.length > 0).toBe(true);
      await context.addCookies(cookies);
      const page = await context.newPage();
      const client = await startFundingClient(page, info, { freeWallet: alias });
      const consolePage = await context.newPage();
      const snapshots: ConsoleRead[] = [];
      const pending: Promise<void>[] = [];
      consolePage.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (!path.endsWith('/billing/snapshot')) return;
        pending.push((async () => { snapshots.push({ path, status: response.status(), body: await response.json() }); })());
      });
      clients.push({ alias, client, page, console: consolePage, snapshots, pending });
      await page.goto(client.runtime.url.web('/'), { waitUntil: 'domcontentloaded', timeout: T.xlong });
      await expect(page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.xlong });
      const url = new URL('/dashboard', fixture.upstream.webUrl);
      url.searchParams.set('workspaceId', wallet.space.workspaceId);
      await consolePage.goto(url.href, { waitUntil: 'domcontentloaded', timeout: T.xlong });
    }
    const witness = async (entry: typeof clients[number], phase: 'before' | 'after') => {
      const { alias, client, page } = entry;
      const wallet = wallets[alias];
      const expected = phase === 'before' ? wallet.beforeBalanceUsd : wallet.afterBalanceUsd;
      const space = wallet.space;
      const contextResponse = await fetch(client.runtime.url.web('/api/workspace/context'), { headers: fundingHeaders(space) });
      expect(contextResponse.ok).toBe(true);
      const context = await contextResponse.json();
      expect(context.context.workspaceId).toBe(space.workspaceId);
      expect(context.context.workspaceMemberId).toBe(space.ownerMemberId);
      expect(context.context.role).toBe('owner');
      expect(context.context.workspaceType).toBe('personal');
      const billingUrl = new URL('/api/workspace/billing', client.runtime.url.web());
      billingUrl.search = new URLSearchParams({ scope: 'workspace', workspaceId: space.workspaceId, includePreflight: '1', modelId: fixture.runtime.modelId }).toString();
      const response = await fetch(billingUrl, { headers: fundingHeaders(space) });
      expect(response.ok).toBe(true);
      const billing = await response.json();
      expect(billing.preflight.workspaceId).toBe(space.workspaceId);
      expect(billing.preflight.workspaceMemberId).toBe(space.ownerMemberId);
      expect(billing.preflight.codingPlan.tier).toBe('free');
      expect(Number(billing.preflight.balanceUsd)).toBe(Number(expected));
      const credits = page.getByTestId('entry-top-right-credits');
      await credits.hover({ timeout: T.medium });
      await credits.click({ timeout: T.medium });
      const panel = page.getByTestId('entry-top-right-credits-panel');
      await expect(panel).toBeVisible({ timeout: T.medium });
      await panel.hover();
      await expect(panel.getByTestId('workspace-quota-skeleton')).toHaveCount(0, { timeout: T.long });
      await expect(panel.getByTestId('entry-nav-credits-row')).toHaveCount(1);
      await expect(panel.getByTestId('entry-nav-credits-row')).toContainText(`$${expected}`, { timeout: T.long });
      await expect(panel.getByRole('button', { name: /recharge|top.?up|add funds|充值/i })).toHaveCount(0);
      const screenshot = await page.screenshot();
      await info.attach(`VIEW021-${alias}-${phase}-simplified-client-wallet`, { body: screenshot, contentType: 'image/png' });
      const panelText = await panel.innerText();
      await page.getByTestId('home-hero-input').click();
      await page.getByTestId('inline-model-switcher-chip').click({ timeout: T.medium });
      const models = page.getByTestId('inline-model-switcher-popover');
      await expect(models).toBeVisible({ timeout: T.medium });
      const rows = await models.locator('button[data-testid^="inline-model-switcher-compact-model-"]').evaluateAll(elements => elements.map(e => ({
        modelId: e.getAttribute('data-testid')!.replace('inline-model-switcher-compact-model-', ''),
        disabled: e.getAttribute('aria-disabled') === 'true', text: e.textContent,
      })));
      expect(rows.some(row => row.modelId === fixture.runtime.modelId), 'Actual Free Flash model must appear').toBe(true);
      expect(rows.filter(row => !row.disabled && row.modelId !== fixture.runtime.modelId), 'Free must not offer another selectable model').toEqual([]);
      const modelScreenshot = await page.screenshot();
      await info.attach(`VIEW021-${alias}-${phase}-actual-Free-model-menu`, { body: modelScreenshot, contentType: 'image/png' });
      await page.keyboard.press('Escape');
      const consolePage = entry.console;
      if (wallets.consoleUi.phase1Enabled) {
        await expect(consolePage.getByTestId('seats-console-page')).toBeVisible({ timeout: T.long });
        await expect(consolePage.getByTestId('seats-wallet-total')).toHaveText(new RegExp(`^(?:US)?\\$${expected.replace('.', '\\.')}$`), { timeout: T.long });
        await expect(consolePage.getByRole('button', { name: /^(?:recharge|top.?up|充值)$/i })).toHaveCount(0);
        await expect(consolePage.getByRole('switch', { name: /auto.?recharge|自动充值/i })).toHaveCount(0);
        await Promise.all(entry.pending);
        expect(entry.snapshots.some(read => read.status === 200 && read.body.workspaceId === space.workspaceId
          && read.body.workspaceMemberId === space.ownerMemberId && Number(read.body.wallet?.balanceUsd) === Number(expected)),
        'Real console snapshot must prove this exact personal workspace/member and amount').toBe(true);
      }
      const consoleScreenshot = await consolePage.screenshot();
      await info.attach(`VIEW021-${alias}-${phase}-${wallets.consoleUi.phase1Enabled ? 'phase1-console' : 'legacy-console-diagnostic-only'}`,
        { body: consoleScreenshot, contentType: 'image/png' });
      const result = { alias, phase, expectedBalanceUsd: expected, context: context.context, billing, panelText, models: rows,
        noRunPosts: client.posts.filter(p => p.path === '/api/runs'), consoleStatus: wallets.consoleUi.phase1Enabled ? 'passed' : 'blocked-config',
        consoleSnapshots: entry.snapshots.slice(), originalGift: proof.wallets[alias] };
      expect(result.noRunPosts).toEqual([]);
      observations.push(result);
      if (phase === 'before') {
        for (const [name, bytes] of [[`${alias}-client.png`, screenshot], [`${alias}-model-menu.png`, modelScreenshot], [`${alias}-console.png`, consoleScreenshot], [`${alias}-client-api.json`, Buffer.from(JSON.stringify(result, null, 2))]] as const) {
          await writeFile(join(beforeDir, name), bytes, { mode: 0o600, flag: 'wx' });
          frozenBefore.push({ path: name, sha256: hash(bytes) });
        }
      }
    };
    for (const client of clients) await witness(client, 'before');
    const beforeManifest = JSON.stringify({ protocol: 'od-free-wallet-before-v1', runId: fixture.isolation.runId, attemptId,
      clientApiBeforeComplete: true, consolePhase1: wallets.consoleUi.phase1Enabled ? 'passed' : 'blocked-config', files: frozenBefore }, null, 2);
    await writeFile(join(beforeDir, 'manifest.safe.json'), beforeManifest, { flag: 'wx', mode: 0o600 });
    await writeFile(join(expiryDir, 'before-manifest.safe.json'), beforeManifest, { flag: 'wx', mode: 0o600 });
    const binding = { protocol: 'od-free-wallet-expiry-v1', runId: fixture.isolation.runId, attemptId,
      fixtureSha256: hash(await readFile(process.env.OD_FUNDING_FIXTURE!)),
      sourceAmrSha: fixture.upstream.amrSha, sandboxName: fixture.owner.sandboxName,
      workspaceIds: { retained: wallets.retained.space.workspaceId, giftOnly: wallets.giftOnly.space.workspaceId } };
    await writeFile(join(expiryDir, 'expiry-ready.safe.json'), JSON.stringify({ ...binding, beforeManifestSha256: hash(beforeManifest),
      beforeScope: wallets.consoleUi.phase1Enabled ? 'Both actual client/API and canonical phase1 consoles complete and frozen' : 'Both actual client/API wallets frozen; phase1 console blocked-config' }), { flag: 'wx', mode: 0o600 });
    const owner = await verifyFundingLease(fixture, T.xlong * 2);
    const command = ['pnpm', '--filter', '@vela/api', 'exec', 'tsx', wallets.expiry.helperPath, '--fixture', process.env.OD_FUNDING_FIXTURE!,
      '--evidence-dir', expiryDir, '--run-id', fixture.isolation.runId, '--attempt-id', attemptId, '--fixture-sha256', binding.fixtureSha256];
    try {
      const result = await promisify(execFile)('corepack', command, { cwd: fixture.owner.sourceRoot, env: { ...process.env, ...owner.env }, timeout: T.xlong * 2, maxBuffer: 1024 * 1024 });
      await writeFile(join(expiryDir, 'expiry-helper.private.log'), result.stdout + result.stderr, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await writeFile(join(expiryDir, 'expiry-helper-failure.private.log'), String(error), { flag: 'wx', mode: 0o600 });
      throw new Error('Server-owned exact-gift expiry failed; inspect private receipt, do not substitute balances');
    }
    const receiptBytes = await readFile(join(expiryDir, 'expiry-receipt.safe.json'));
    const receipt = JSON.parse(receiptBytes.toString());
    const complete = JSON.parse(await readFile(join(expiryDir, 'expiry-complete.safe.json'), 'utf8'));
    for (const key of ['protocol', 'runId', 'attemptId', 'fixtureSha256', 'workspaceIds', 'sourceAmrSha', 'sandboxName'] as const) expect(receipt[key]).toEqual(binding[key]);
    expect(complete.receiptSha256).toBe(hash(receiptBytes));
    expect(receipt.beforeManifestSha256).toBe(hash(beforeManifest));
    for (const key of ['protocol', 'runId', 'attemptId', 'fixtureSha256', 'workspaceIds', 'sourceAmrSha', 'sandboxName'] as const) expect(complete[key]).toEqual(binding[key]);
    expiryExecuted = true;
    await info.attach('VIEW021-owned-original-gift-expiry-receipt', { body: receiptBytes, contentType: 'application/json' });
    for (const entry of clients) {
      await entry.page.reload({ waitUntil: 'domcontentloaded', timeout: T.xlong });
      await expect(entry.page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.xlong });
      await entry.console.reload({ waitUntil: 'domcontentloaded', timeout: T.xlong });
      await witness(entry, 'after');
    }
    bodyCompleted = true;
  } finally {
    await info.attach('VIEW021-exact-scope-results', { body: JSON.stringify({ attemptId, observations, expiryExecuted,
      consolePhase1Status: wallets.consoleUi.phase1Enabled ? 'executed' : 'blocked-config', clientApiPortionPassed: observations.length === 4 && expiryExecuted,
      wholeQaPassed: false, proposedComplete: wallets.consoleUi.phase1Enabled && observations.length === 4 && expiryExecuted,
      reason: 'Actual full two-surface scope and independent server/root audit required; no legacy-console substitution' }, null, 2), contentType: 'application/json' });
    const cleanup = await Promise.allSettled(clients.map(entry => entry.client.close()));
    const contextCleanup = await Promise.allSettled(contexts.map(async (context, index) => {
      const path = info.outputPath(`view021-context-${index}-trace.zip`);
      try {
        await context.tracing.stop({ path });
        await info.attach(`VIEW021-context-${index}-trace`, { path, contentType: 'application/zip' });
      } finally { await context.close(); }
    }));
    await info.attach('VIEW021-owned-cleanup-status', { body: JSON.stringify({
      runtimes: cleanup.map(result => result.status), contexts: contextCleanup.map(result => result.status),
    }), contentType: 'application/json' });
    if (bodyCompleted) expect([...cleanup, ...contextCleanup].every(result => result.status === 'fulfilled')).toBe(true);
  }
});
