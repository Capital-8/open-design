import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { clusterTest, test, expect } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';
import { commentWorkspaceFixture } from '@/playwright/comment-workspace-fixture';

const NOW = new Date('2026-10-28T06:00:00Z');
const LONG_NAME = 'Alexandria Catherine Montgomery-Wellington';
const NOTE = 'يرجى تحديث Target 42 — 中文反馈';
test.use({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light', deviceScaleFactor: 1 });

async function seed(page: Page, controls = false, extraHtml = '') {
  await applyStandardMocks(page);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    localStorage.setItem('open-design:locale', 'zh-CN');
    localStorage.setItem('open-design:locale-source', 'manual');
  });
  const id = `comment-rules-${randomUUID()}`;
  const created = await page.request.post('/api/projects', { data: { id, name: '评论交互规则', skillId: null, designSystemId: null, metadata: { kind: 'prototype', nameSource: 'user' } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { conversationId } = await created.json() as { conversationId: string };
  const written = await page.request.post(`/api/projects/${id}/files`, { data: { name: 'index.html', content: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:80px;font-family:system-ui;background:#faf9f6"><h1 data-od-id="hero">让反馈成为下一步行动</h1><p>保留每一条还没处理的建议</p>' + (controls ? '<div role="menu"><button id="frame-menu">Frame menu</button></div><dialog open style="position:static"><button id="frame-dialog">Frame dialog</button></dialog><button id="frame-handled" onkeydown="event.preventDefault()">Frame handled</button><input id="frame-input"><button id="frame-plain">Frame plain</button>' : '') + extraHtml + '</body></html>', artifactManifest: { version: 1, kind: 'html', title: '评论规则', entry: 'index.html', renderer: 'html', exports: ['html'] } } });
  expect(written.ok(), await written.text()).toBeTruthy();
  return { id, conversationId };
}

async function open(page: Page, id: string) {
  await page.goto(`/projects/${id}/files/index.html`);
  await expect(page.frameLocator('iframe:visible').getByRole('heading')).toBeVisible({ timeout: T.long });
  // Match the design review's expanded artifact surface. The chat-open split
  // can hide the original toolbar button after the comments dock mounts.
  const collapseChat = page.getByTestId('chat-collapse-toggle');
  if (await collapseChat.isVisible()) await collapseChat.click();
  expect(await page.evaluate(() => ({ scale: visualViewport?.scale, zoom: getComputedStyle(document.documentElement).zoom }))).toEqual({ scale: 1, zoom: '1' });
}

function visibleAttachment() {
  const png = new PNG({ width: 160, height: 96 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const offset = (png.width * y + x) * 4;
    const gold = x > 24 && x < 136 && y > 24 && y < 72;
    png.data.set(gold ? [255, 190, 55, 255] : [33, 106, 167, 255], offset);
  }
  return { name: 'visible-blue-gold.png', mimeType: 'image/png', buffer: PNG.sync.write(png) };
}

test('[P0] D05 native menu Escape retains visible image and draft then restores the exact creation opener', async ({ page }, testInfo) => {
  const { id } = await seed(page);
  await open(page, id);
  const opener = page.getByTestId('board-mode-toggle');
  await opener.click();
  await page.frameLocator('iframe:visible').getByRole('heading').click();
  const popover = page.getByTestId('comment-popover');
  const input = popover.getByTestId('comment-popover-input');
  await input.fill('CV16 受控草稿与可见附件');
  await popover.locator('input[type="file"]').setInputFiles(visibleAttachment());
  const image = popover.locator('button img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.complete, node.naturalWidth, node.naturalHeight])).toEqual([true, 160, 96]);
  const src = await image.getAttribute('src');
  await popover.getByRole('button', { name: '更多评论操作' }).click();
  await expect(popover.getByRole('menu')).toBeVisible();
  await expect.poll(() => popover.getByRole('menu').evaluate(node => node.matches(':popover-open'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('D05-menu.png') });
  await page.keyboard.press('Escape');
  await expect(popover.getByRole('menu')).toBeHidden();
  await expect(input).toHaveValue('CV16 受控草稿与可见附件');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', src!);
  await expect(opener).not.toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('D05-first-escape.png') });
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('D05-second-escape.png') });
  await testInfo.attach('D05-focus-after-close', { body: JSON.stringify(await page.evaluate(() => ({ active: { tag: document.activeElement?.tagName, id: document.activeElement?.id, testId: document.activeElement?.getAttribute('data-testid') }, opener: (() => { const node = document.querySelector('[data-testid=board-mode-toggle]'); return { connected: node?.isConnected, rect: node?.getBoundingClientRect().toJSON(), display: node && getComputedStyle(node).display, visibility: node && getComputedStyle(node).visibility }; })(), focused: [...document.querySelectorAll(':focus')].map(node => ({ tag: node.tagName, id: node.id, testId: node.getAttribute('data-testid') })) }))), contentType: 'application/json' });
  await expect(opener).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('D05-second-escape.png') });
});

test('[P0] B08 actual 240px resizer preserves full author title, wrapped timestamp and mixed RTL without overflow; D06 list and pin restore exact openers', async ({ page }, testInfo) => {
  const { id, conversationId } = await seed(page);
  const saved = await page.request.post(`/api/projects/${id}/conversations/${conversationId}/comments`, { data: { target: { filePath: 'index.html', elementId: 'hero', selector: '[data-od-id="hero"]', label: 'h1', text: '让反馈成为下一步行动', htmlHint: '<h1>', position: { x: 80, y: 80, width: 350, height: 48 } }, note: NOTE } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  // Presentation-only author/date fixture; project, comments, DOM observation and
  // opener interactions use the real daemon. This is not identity/relay evidence.
  await page.route(`**/api/projects/${id}/conversations/*/comments`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, comments: body.comments.map((comment: object) => ({ ...comment, authorDisplayName: LONG_NAME, createdAt: Date.parse('2025-01-02T03:04:00Z') })) } });
  });
  await open(page, id);
  await page.getByTestId('comment-panel-toggle').click();
  const dock = page.getByTestId('comment-side-dock');
  const resizer = dock.getByRole('separator');
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await resizer.focus();
  // Use the product's accessible resizer control rather than writing CSS.
  for (let step = 0; step < 5; step++) {
    await expect(resizer).toBeFocused();
    await resizer.press('ArrowRight');
    await expect(resizer).toHaveAttribute('aria-valuenow', String(320 - (step + 1) * 16));
  }
  await expect(resizer).toHaveAttribute('aria-valuenow', '240');
  // The existing floating host owns the requested width and a 1px left
  // border; shell.css gives its flex child the remaining content width.
  const host = page.locator('.comment-float-host').filter({ has: dock });
  await expect(host).toHaveCSS('width', '240px');
  const geometry = await host.evaluate(node => {
    const css = getComputedStyle(node);
    const inner = node.querySelector('[data-testid="comment-side-dock"]')!;
    return { host: node.getBoundingClientRect().width, dock: inner.getBoundingClientRect().width, borders: parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth) };
  });
  expect(geometry.host).toBe(240);
  expect(geometry.dock).toBe(geometry.host - geometry.borders);
  await testInfo.attach('B08-dock-measurement', { body: JSON.stringify(await dock.evaluate(node => ({ width: node.getBoundingClientRect().width, computed: getComputedStyle(node).width, inline: (node as HTMLElement).style.width, client: node.clientWidth, borderLeft: getComputedStyle(node).borderLeftWidth, borderRight: getComputedStyle(node).borderRightWidth, boxSizing: getComputedStyle(node).boxSizing, parent: node.parentElement?.getBoundingClientRect().width }))), contentType: 'application/json' });
  const row = page.getByTestId('comment-side-item');
  await expect(row).toHaveCount(1);
  await expect(row.locator('strong')).toHaveAttribute('title', LONG_NAME);
  await expect(row.locator('strong')).toHaveText(LONG_NAME);
  const mixedBody = row.locator('[dir="auto"]').filter({ hasText: NOTE }).last();
  await expect(mixedBody).toBeVisible();
  await expect(mixedBody).toHaveCSS('direction', 'rtl');
  const metrics = await row.evaluate(node => {
    const name = node.querySelector('strong')!;
    const time = node.querySelector('.comment-side-time')!;
    return { overflow: node.scrollWidth > node.clientWidth, nameClipped: name.scrollWidth > name.clientWidth, nameBottom: name.getBoundingClientRect().bottom, timeTop: time.getBoundingClientRect().top, time: time.textContent, timeTitle: time.getAttribute('title'), timeOverflow: time.scrollWidth > time.clientWidth };
  });
  expect(metrics.overflow).toBe(false);
  expect(metrics.nameClipped).toBe(true);
  expect(metrics.timeTop).toBeGreaterThanOrEqual(metrics.nameBottom);
  expect(metrics.time).toMatch(/2025/);
  expect(metrics.timeTitle).toMatch(/2025/);
  expect(metrics.timeOverflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('B08-narrow-mixed-list.png') });
  await testInfo.attach('B08-layout-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  await row.click();
  const detail = page.getByTestId('comment-popover');
  await expect(detail.getByTestId('comment-popover-detail')).toContainText(NOTE);
  await detail.getByRole('button', { name: '更多评论操作' }).focus();
  await expect(row).not.toBeFocused();
  await detail.getByRole('button', { name: '更多评论操作' }).click();
  await expect(detail.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('D06-list-detail.png') });
  await page.keyboard.press('Escape');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(row).toBeFocused();
  const pin = page.getByTestId('comment-saved-marker-hero').getByRole('button');
  await pin.click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '更多评论操作' }).focus();
  await expect(pin).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(pin).toBeFocused();
});

clusterTest('[P0] CV19 authoritative published version and real DOM report uncertainty in list and detail', async ({ browser }, testInfo) => {
  clusterTest.setTimeout(T.xlong * 4);
  const fixture = await commentWorkspaceFixture(browser, testInfo);
  const { page, headers, workspaceId } = fixture;
  let succeeded = false;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(NOW);
    await page.addInitScript(() => {
      localStorage.setItem('open-design:locale', 'zh-CN'); localStorage.setItem('open-design:locale-source', 'manual');
      const observations: unknown[] = [];
      Object.assign(window, { __commentDOMObservations: observations });
      window.addEventListener('message', event => {
        if (event.data?.type === 'od:comment-targets' && Array.isArray(event.data.targets)) observations.push({ type: event.data.type, fromActiveFrame: [...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source), targets: event.data.targets });
      });
    });
    const id = `comment-authority-${randomUUID()}`;
    const created = await page.request.post('/api/projects', { headers, data: { id, name: 'Comment anchor uncertainty', skillId: null, designSystemId: null, metadata: { kind: 'prototype' } } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { conversationId } = await created.json() as { conversationId: string };
    const written = await page.request.post(`/api/projects/${id}/files`, { headers, data: { name: 'index.html', content: '<!doctype html><html><meta charset="utf-8"><body style="padding:80px"><h1 data-od-id="current-heading">Real DOM target</h1><p data-od-id="neighbor">Neighbor must not be selected</p>' + '</body></html>', artifactManifest: { version: 1, kind: 'html', title: 'Anchor uncertainty', entry: 'index.html', renderer: 'html', exports: ['html'] } } });
    expect(written.ok(), await written.text()).toBeTruthy();
    const moved = await page.request.post(`/api/workspaces/${workspaceId}/projects/${id}/move`, { headers, data: { visibility: 'team' }, timeout: T.long });
    expect(moved.ok(), await moved.text()).toBeTruthy();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/projects/${id}/collab/status`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).publishedVersion;
    }, { timeout: T.long }).toBeGreaterThan(0);
    const target = { filePath: 'index.html', elementId: 'current-heading', selector: '[data-od-id="current-heading"]', label: 'h1', text: 'Real DOM target', htmlHint: '<h1>', position: { x: 80, y: 80, width: 300, height: 50 }, anchoredVersion: 0 };
    for (const [elementId, note] of [['current-heading', 'Earlier published version'], ['legacy-heading', 'Moved legacy anchor']]) {
      const saved = await page.request.post(`/api/projects/${id}/conversations/${conversationId}/comments`, { headers, data: { target: { ...target, elementId }, note } });
      expect(saved.ok(), await saved.text()).toBeTruthy();
    }
    await open(page, id);
    await page.getByTestId('comment-panel-toggle').click();
    const authority = await page.request.get(`/api/projects/${id}/collab/status`, { headers });
    await testInfo.attach('CV19-authoritative-publication', { body: JSON.stringify(await authority.json()), contentType: 'application/json' });
    for (const [note, notice] of [['Earlier published version', '基于旧版本'], ['Moved legacy anchor', '锚点可能已移动']] as const) {
      const row = page.getByTestId('comment-side-item').filter({ hasText: note });
      await expect(row.getByTestId('comment-location-notice')).toContainText(notice);
      await row.screenshot({ path: testInfo.outputPath(`CV19-${note.startsWith('Earlier') ? 'reanchored' : 'stale'}-list.png`) });
      await row.click();
      const detail = page.getByTestId('comment-popover');
      await expect(detail).toBeVisible();
      await expect(detail).toContainText(note);
      await expect(detail).toContainText(notice);
      await expect(detail).not.toContainText('Neighbor must not be selected');
      await page.screenshot({ path: testInfo.outputPath(`CV19-${note.startsWith('Earlier') ? 'reanchored' : 'stale'}-detail.png`) });
      await detail.getByRole('button', { name: '更多评论操作' }).focus();
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
      await expect(row).toBeFocused();
    }
    await testInfo.attach('CV19-real-DOM-reports', { body: JSON.stringify(await page.evaluate(() => (window as unknown as { __commentDOMObservations: unknown[] }).__commentDOMObservations)), contentType: 'application/json' });
    succeeded = true;
  } finally { await fixture.close(succeeded); }
});

test('[P0] CV04 host and active preview respect native shortcut guards before accepting ordinary C', async ({ page }, testInfo) => {
  const { id } = await seed(page, true);
  await open(page, id);
  const tool = page.getByTestId('board-mode-toggle');
  const frame = page.frameLocator('iframe:visible');
  for (const selector of ['#frame-menu', '#frame-dialog', '#frame-handled', '#frame-input']) {
    await frame.locator(selector).focus();
    await page.keyboard.press('c');
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
  }
  await frame.locator('#frame-plain').focus();
  await frame.locator('#frame-plain').evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', isComposing: true, bubbles: true, cancelable: true })));
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('c');
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    const controls = document.createElement('div');
    controls.id = 'comment-shortcut-host-controls';
    controls.style.cssText = 'position:fixed;z-index:100000;top:100px;left:20px;background:white';
    controls.innerHTML = '<div role="menu"><button id="host-menu">Host menu</button></div><dialog open style="position:static"><button id="host-dialog">Host dialog</button></dialog><button id="host-handled">Host handled</button><input id="host-input"><button id="host-plain">Host plain</button>';
    controls.querySelector('#host-handled')!.addEventListener('keydown', event => event.preventDefault());
    document.body.append(controls);
  });
  try {
    for (const selector of ['#host-menu', '#host-dialog', '#host-handled', '#host-input']) {
      await page.locator(selector).focus();
      await page.keyboard.press('c');
      await expect(tool).toHaveAttribute('aria-pressed', 'false');
    }
    await page.locator('#host-plain').focus();
    await page.locator('#host-plain').evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', isComposing: true, bubbles: true, cancelable: true })));
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('c');
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('CV04-host-frame-controls.png') });
  } finally { await page.evaluate(() => document.getElementById('comment-shortcut-host-controls')?.remove()); }
});


test('[P0] CV05 real small-element bounds and canvas intersections preserve selected geometry', async ({ page }, info) => {
  const { id } = await seed(page, false, `<style>
    .cv05 { position:absolute; background:#e6b85c; padding:0; margin:0; }
    #tiny { left:80px; top:180px; width:4px; height:4px; }
    #left-edge { left:-20px; top:240px; width:120px; height:80px; }
    #right-edge { left:calc(100% - 60px); top:360px; width:120px; height:80px; }
    #top-edge { left:400px; top:-20px; width:100px; height:80px; }
    #bottom-edge { left:400px; top:calc(100vh - 40px); width:100px; height:80px; }
    </style><button class="cv05" id="tiny" style="border:0" aria-label="Tiny target"></button>
    <div class="cv05" id="left-edge" data-od-id="left-edge">Left edge</div>
    <div class="cv05" id="right-edge" data-od-id="right-edge">Right edge</div>
    <div class="cv05" id="top-edge" data-od-id="top-edge">Top edge</div>
    <div class="cv05" id="bottom-edge" data-od-id="bottom-edge">Bottom edge</div>`);
  await open(page, id);
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/comments')) posts.push(request.url()); });
  await page.getByTestId('board-mode-toggle').click();
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  const frame = page.frameLocator('iframe:visible');
  const outline = page.getByTestId('comment-target-overlay');
  for (const name of ['tiny', 'left-edge', 'right-edge', 'top-edge', 'bottom-edge']) {
    const target = frame.locator(`#${name}`);
    const rect = await target.boundingBox();
    const canvas = await page.locator('iframe:visible').boundingBox();
    if (!rect || !canvas) throw new Error('Missing CV05 geometry');
    const expected = { x: Math.max(rect.x, canvas.x), y: Math.max(rect.y, canvas.y),
      width: Math.min(rect.x + rect.width, canvas.x + canvas.width) - Math.max(rect.x, canvas.x), height: Math.min(rect.y + rect.height, canvas.y + canvas.height) - Math.max(rect.y, canvas.y) };
    await page.mouse.move(expected.x + expected.width / 2, expected.y + expected.height / 2);
    await expect(outline).toBeVisible();
    await expect.poll(() => outline.boundingBox()).toEqual(expected);
    await expect(page.getByTestId('comment-popover')).toHaveCount(0);
    expect(posts).toEqual([]);
    await page.screenshot({ path: info.outputPath(`CV05-${name}-hover.png`) });
    await page.mouse.click(expected.x + expected.width / 2, expected.y + expected.height / 2);
    await expect(page.getByTestId('comment-popover')).toBeVisible();
    await expect.poll(() => outline.boundingBox()).toEqual(expected);
    await page.screenshot({ path: info.outputPath(`CV05-${name}-selected.png`) });
    expect(posts).toEqual([]);
    await page.getByTestId('comment-popover-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('comment-popover')).toHaveCount(0);
  }
});
