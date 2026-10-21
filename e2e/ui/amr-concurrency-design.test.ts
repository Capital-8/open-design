import { expect, test } from '@/playwright/suite';
import { applyStandardMocks, routeAgents, routeSuccessfulRuns } from '@/playwright/mock-factory';
import { mockSignedInVelaAccount } from '@/playwright/visual';
import { AMR_PERSONAL_WORKSPACE_CONTEXT, createProjectViaApi, gotoProject, seedBrowserConfig } from '@/playwright/amr';
import { T } from '@/timeouts';

// UISTATE-F04-CLIENT / YANG-E2E-009: a controlled Link rejection witnesses
// the running browser's illustration, benefits and native upgrade action.
// Role/plan decisions remain covered by AmrConcurrencyDialog component tests.
test('[P0] F04 concurrency rejection renders the approved Cloud offer and stays manual', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    localStorage.setItem('open-design:locale', 'zh-CN');
    localStorage.setItem('open-design:locale-source', 'manual');
  });
  await applyStandardMocks(page);
  await mockSignedInVelaAccount(page, { plan: 'pro', balanceUsd: '100.00' });
  await routeAgents(page, [{ id: 'amr', name: 'OpenDesign AMR', bin: 'vela', available: true,
    version: 'test', models: [{ id: 'glm-5', label: 'glm-5' }] }]);
  await seedBrowserConfig(page, { mode: 'daemon', apiKey: '', baseUrl: 'https://api.anthropic.com',
    model: 'glm-5', agentId: 'amr', skillId: null, designSystemId: null, onboardingCompleted: true,
    agentModels: { amr: 'glm-5' }, privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false } });
  await page.route('**/api/app-config', route => route.fulfill({ json: { config: {
    onboardingCompleted: true, agentId: 'amr', skillId: null, designSystemId: null,
    agentModels: { amr: { model: 'glm-5' } }, privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false },
  } } }));
  const projectId = `f04-${testInfo.testId}-${Date.now()}`;
  await createProjectViaApi(page, projectId, 'F04 concurrency offer', {
    accountPlan: 'pro', accountBalanceUsd: '100.00', accountCredits: 1_000_000,
  });
  const context = { ...AMR_PERSONAL_WORKSPACE_CONTEXT, planId: 'team_pro' };
  await page.route('**/api/workspace/context', route => route.fulfill({ json: { context } }));
  await page.route(`**/api/projects/${projectId}/workspace-scope`, route => route.fulfill({ json: {
    scope: { kind: 'personal', projectId, workspaceId: context.workspaceId, visibility: 'personal', context },
  } }));
  await page.route('**/api/workspace/billing/preflight?**', route => route.fulfill({ json: { preflight: {
    schemaVersion: 1, workspaceId: context.workspaceId, workspaceMemberId: context.workspaceMemberId,
    modelId: 'glm-5', generatedAt: new Date().toISOString(), balanceUsd: '100', funding: 'wallet',
    fundingCheck: 'available', modelCovered: false, codingPlan: { workspaceId: context.workspaceId,
      generatedAt: new Date().toISOString(), eligible: false, tier: null, windows: [] },
  } } }));
  const events = [
    'event: start', 'data: {"bin":"vela"}', '',
    'event: agent', 'data: {"type":"done_key","key":"f04-protocol-key"}', '',
    'event: error', 'data: {"message":"membership concurrency limit exceeded","code":"AGENT_EXECUTION_FAILED","failureDetail":"membership_concurrency_limit"}', '',
    'event: end', 'data: {"code":1,"status":"failed","failureDetail":"membership_concurrency_limit"}', '', '',
  ].join('\n');
  const runs = await routeSuccessfulRuns(page, { runId: `f04-rejected-${Date.now()}`, eventBody: events });
  await gotoProject(page, projectId);
  const input = page.getByTestId('chat-composer-input');
  await expect(input).toBeVisible({ timeout: T.long });
  await input.fill('Preserve the original F04 draft');
  await page.getByTestId('chat-send').click();
  const dialog = page.getByTestId('amr-concurrency-dialog');
  await expect(dialog).toBeVisible({ timeout: T.long });
  // Inspect the first modal state before any in-dialog click can move focus
  // away from the send/stop control and conceal its lingering tooltip.
  await testInfo.attach('f04-initial-focus', { body: JSON.stringify(await page.evaluate(() => ({
    active: document.activeElement?.outerHTML,
    tooltip: document.querySelector('.od-tooltip-layer')?.outerHTML,
  })), null, 2), contentType: 'application/json' });
  await testInfo.attach('f04-initial-modal', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement)))
    .toBe(true);
  // The frozen F04 frame uses normal line-height and a neutral palette;
  // inherited app typography compressed the title and shifted all content up.
  await expect(dialog.locator('h2')).toHaveCSS('line-height', 'normal');
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByTestId('amr-concurrency-close')).toHaveCSS('font-size', '13.5px');
  // This offer is deliberately neutral even when app appearance uses a color.
  await page.locator('html').evaluate(element => element.style.setProperty('--accent', '#1A74FF'));
  await expect(page.getByTestId('amr-concurrency-upgrade')).toHaveCSS('background-color', 'rgb(53, 53, 53)');
  await expect(dialog).toContainText('当前并发不足，请升级套餐后再试。');
  await expect(dialog.locator('li')).toHaveCount(4);
  await expect(dialog.locator('li')).toHaveText([
    '无需复杂配置，海量 SOTA 模型任选',
    '邀请成员免费加入，共享额度',
    '支持多模态图像创作，图文一站生成',
    '作品一键发布上线，链接随时分享',
  ]);
  await expect(dialog.locator('img')).toHaveAttribute('src', '/upgrade/cloud-signin-aurora.jpg');
  await dialog.locator('img').evaluate((image: HTMLImageElement) => image.decode());
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(480);
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
  });
  // Capture the actual window.open destination while preventing external navigation.
  await page.evaluate(() => { window.open = ((url: string | URL | undefined) => {
    document.documentElement.dataset.f04Upgrade = String(url); return null;
  }) as typeof window.open; });
  await page.getByTestId('amr-concurrency-upgrade').click();
  const target = new URL(await page.locator('html').getAttribute('data-f04-upgrade') ?? '');
  expect(target.searchParams.get('workspaceId')).toBe(context.workspaceId);
  expect(target.searchParams.get('billing')).toBe('plan');
  expect(runs.bodies).toHaveLength(1);
  // Native modal interaction must also leave no background tooltip behind.
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toBeHidden();
  await testInfo.attach('f04-viewport-1280x720', { body: await page.screenshot(), contentType: 'image/png' });
  await testInfo.attach('f04-dialog', { body: await dialog.screenshot(), contentType: 'image/png' });
  await testInfo.attach('f04-geometry', { body: JSON.stringify(await dialog.evaluate(element =>
    [element, ...element.querySelectorAll('h2,p,ul,li,button')].map(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { tag: node.tagName, text: node.textContent, x: rect.x, y: rect.y,
        width: rect.width, height: rect.height, font: style.font, lineHeight: style.lineHeight,
        background: style.backgroundColor, color: style.color, padding: style.padding, margin: style.margin };
    })), null, 2), contentType: 'application/json' });
  // The current app deliberately stays light on a dark OS. F04 must follow
  // that existing appearance policy without adding a separate theme surface.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByTestId('amr-concurrency-close').click();
  await expect(dialog).toHaveCount(0);
  expect(runs.bodies).toHaveLength(1);
});
