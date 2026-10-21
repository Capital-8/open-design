import { expect, test } from '@/playwright/suite';
import {
  gotoEntryHome,
  mockAmrPersonalWorkspace,
  seedBrowserConfig,
} from '@/playwright/amr';
import { routeAgents } from '@/playwright/mock-factory';
import { mockSignedInVelaAccount } from '@/playwright/visual';

// LINK-C21-VIEW-016-001: the first enabled Flash row must receive a native
// click at the reported viewport, with the real workspace header still present.
test.use({ viewport: { width: 1280, height: 720 } });

test('[P1] home Flash model remains clickable below workspace chrome', async ({ page }, testInfo) => {
  const config = {
    mode: 'daemon', apiKey: '', baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5', agentId: 'amr', skillId: null,
    designSystemId: null, onboardingCompleted: true,
    agentModels: { amr: { model: 'deepseek-v4.1-flash' } },
    privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false },
  };
  await seedBrowserConfig(page, config);
  await page.route('**/api/app-config', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { config } }) : route.continue());
  await routeAgents(page, [{
    id: 'amr', name: 'OpenDesign AMR', bin: 'vela', available: true, version: 'test',
    models: [
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', enabled: true },
      { id: 'deepseek-v4.1-pro', label: 'DeepSeek V4.1 Pro', enabled: false },
      { id: 'gpt-6-sol', label: 'GPT 6 Sol', enabled: false },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `claude-model-${i}`, label: `Claude Model ${i}`, enabled: false })),
    ],
  }]);
  await mockSignedInVelaAccount(page, { balanceUsd: '20.00' });
  await mockAmrPersonalWorkspace(page, undefined, { accountBalanceUsd: '20.00' });
  let releasePlugins!: () => void;
  const pluginsReady = new Promise<void>((resolve) => { releasePlugins = resolve; });
  await page.route('**/api/plugins', async (route) => {
    const response = await route.fetch();
    await pluginsReady;
    await route.fulfill({ response });
  });
  await gotoEntryHome(page);
  const chip = page.getByTestId('inline-model-switcher-chip');
  const menu = page.getByTestId('inline-model-switcher-popover');
  const flash = page.getByTestId('inline-model-switcher-compact-model-deepseek-v4.1-flash');
  await chip.click();
  await expect(flash).toBeVisible();
  const initialChip = await chip.boundingBox();
  releasePlugins();
  await expect(page.locator('.home-hero__plugin-presets-wrap')).toBeVisible();
  await expect.poll(async () => (await chip.boundingBox())?.y ?? Infinity,
    { message: 'the arriving Home examples move the composer while its menu stays open' })
    .toBeLessThan(initialChip!.y - 50);
  await testInfo.attach('chip-layout-shift.json', {
    body: JSON.stringify({ initialChip, after: await chip.boundingBox() }), contentType: 'application/json',
  });
  await testInfo.attach('home-model-menu-before-native-click', {
    body: await page.screenshot(), contentType: 'image/png',
  });
  const layout = await flash.evaluate((row) => {
    const rect = row.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { row: rect.toJSON(), hit: target?.outerHTML.slice(0, 500),
      header: document.querySelector('.workspace-tabs-chrome')?.getBoundingClientRect().toJSON(),
      scrollport: row.closest('.entry-main--scroll')?.getBoundingClientRect().toJSON(),
      innerTopbar: row.closest('.entry-main--scroll')?.querySelector('.entry-main__topbar')?.getBoundingClientRect().toJSON(),
      menu: row.closest('[data-testid="inline-model-switcher-popover"]')?.getBoundingClientRect().toJSON(),
      reachable: target != null && row.contains(target) };
  });
  await testInfo.attach('model-menu-hit-target.json', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
  await flash.click();
  await expect(menu).toHaveCount(0);

  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(flash).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(chip).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);

  await chip.click();
  await page.setViewportSize({ width: 1000, height: 620 });
  await expect.poll(async () => {
    const box = await menu.boundingBox();
    return box != null && box.y >= 44 && box.y + box.height <= 620;
  }, { message: 'the resized menu stays below shell chrome and above the viewport edge' }).toBe(true);
  await flash.click();
  await chip.click();
  const beforeScroll = await chip.boundingBox();
  const scrollport = page.locator('.entry-main--scroll');
  const scrollState = await scrollport.evaluate((element) => ({
    top: element.scrollTop, max: element.scrollHeight - element.clientHeight,
  }));
  expect(scrollState.max, 'the Home scrollport has scrollable content').toBeGreaterThan(0);
  const scrollBox = await scrollport.boundingBox();
  // The examples have their own scroller. Wheel over the main column's
  // gutter so this exercises menu anchoring to its scrollport instead.
  await page.mouse.move(scrollBox!.x + 4, scrollBox!.y + scrollBox!.height / 2);
  await page.mouse.wheel(0, scrollState.top > 0 ? -60 : 60);
  await expect.poll(async () => (await chip.boundingBox())?.y).not.toBe(beforeScroll!.y);
  await expect(menu).toBeVisible();
  await flash.click();
  await expect(menu).toHaveCount(0);
  await testInfo.attach('model-menu-after-scroll-resize-keyboard', {
    body: await page.screenshot(), contentType: 'image/png',
  });
});
