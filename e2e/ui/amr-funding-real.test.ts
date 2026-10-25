// RUN-004 opt-in browser witness for the five roles' real funding denial.
// The 0600 JSON fixture contains a zero-balance Free space, exhausted Go/Max
// plan windows, and Go Admin/Member identities in an owned local AMR sandbox.
// Set OD_RUN004_REAL_FIXTURE, OD_RUN004_VELA_BIN, and OD_RUN004_OPENCODE_BIN.
// Successful model completion, settlement, and disconnect recovery are separate.
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { clusterTest as test, expect } from '@/playwright/suite';
import { createToolsDevSuite, e2eWorkspaceRoot } from '@/tools-dev/runtime';
import { warmPlaywrightDaemonRuntime, warmPlaywrightWebRuntime } from '@/playwright/runtime-lifecycle';
import { T } from '@/timeouts';

type Actor = { userId: string; email: string; controlKey: string; runtimeKey: string; memberId: string };
type Space = { workspaceId: string; tier: string };
type Fixture = { prefix: string; actors: Record<string, Actor>; spaces: Record<string, Space>;
  urls: { api: string; link: string; web: string } };
const fixturePath = process.env.OD_RUN004_REAL_FIXTURE;
// An explicit owner-scoped sandbox fixture enables this live cross-layer witness.
// The standard UI suite skips it because CI has no AMR account or Link sandbox.
const fixture = fixturePath ? await loadFixture(fixturePath) : null;
const velaBin = process.env.OD_RUN004_VELA_BIN;
const opencodeBin = process.env.OD_RUN004_OPENCODE_BIN;

async function loadFixture(path: string): Promise<Fixture> {
  if (((await stat(path)).mode & 0o077) !== 0) throw new Error('RUN-004 fixture must be owner-only (0600)');
  const value = JSON.parse(await readFile(path, 'utf8')) as Fixture;
  for (const endpoint of Object.values(value.urls)) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new Error('RUN-004 fixture endpoints must be isolated loopback URLs');
  }
  return value;
}

const cases = [
  { role: 'free-owner', space: 'free', model: 'deepseek-v4.1-flash', kind: 'owner', cta: true },
  { role: 'go-owner', space: 'go', model: 'e2e-limit-model', kind: 'owner', cta: true },
  { role: 'max-owner', space: 'max', model: 'e2e-limit-model', kind: 'owner', cta: false },
  { role: 'admin', space: 'go', model: 'e2e-limit-model', kind: 'admin', cta: false },
  { role: 'member', space: 'go', model: 'e2e-limit-model', kind: 'member', cta: false },
] as const;

test.describe('RUN-004 real funding denial matrix', () => {
  test.skip(!fixturePath, 'Requires an explicit isolated RUN-004 fixture');
  for (const scenario of cases) {
    test(`[P0] RUN-004 real funding preflight ${scenario.role}`, async ({ page }, info) => {
      test.setTimeout(T.xlong * 3);
      if (!fixture || !velaBin || !opencodeBin) throw new Error('Complete owned fixture and Vela/OpenCode binaries required');
      const actor = fixture.actors[scenario.role];
      const space = fixture.spaces[scenario.space];
      if (!actor || !space) throw new Error(`Missing real fixture ${scenario.role}/${scenario.space}`);
      const namespace = `run004-${scenario.role}-${randomUUID().slice(0, 8)}`;
      const root = join(e2eWorkspaceRoot(), '.tmp', 'e2e', namespace);
      const scratch = join(root, 'scratch');
      const suite = createToolsDevSuite({
        root, namespace, ownerPid: process.pid,
        dataDir: join(scratch, 'data'), toolsDevRoot: join(scratch, 'tools-dev'),
        codexHomeDir: join(scratch, 'codex-home'),
      });
      const amrHome = join(scratch, 'amr-home');
      await mkdir(amrHome, { recursive: true, mode: 0o700 });
      await mkdir(suite.dataDir, { recursive: true });
      await writeFile(join(amrHome, 'config.json'), JSON.stringify({ profiles: { local: {
        controlKey: actor.controlKey, runtimeKey: actor.runtimeKey,
        apiUrl: fixture.urls.api, linkUrl: fixture.urls.link,
        user: { id: actor.userId, email: actor.email, name: `RUN004 ${scenario.role}` },
      } } }), { mode: 0o600 });
      const config = { privacyDecisionAt: 1, telemetry: { metrics: false, content: false, artifactManifest: false },
        mode: 'daemon', agentId: 'amr', model: scenario.model, onboardingCompleted: true,
        agentModels: { amr: { model: scenario.model } },
        agentCliEnv: { amr: { OPEN_DESIGN_AMR_PROFILE: 'local', VELA_BIN: velaBin } } };
      await writeFile(join(suite.dataDir, 'app-config.json'), JSON.stringify(config));
      const env = { AMR_HOME: amrHome, VELA_BIN: velaBin, VELA_PROFILE: 'local',
        OPEN_DESIGN_AMR_PROFILE: 'local', VELA_API_URL: fixture.urls.api,
        VELA_LINK_URL: fixture.urls.link, VELA_CONTROL_KEY: actor.controlKey,
        VELA_OPENCODE_BIN: opencodeBin, OD_WORKSPACE_CONTEXT_SOURCE: 'vela',
        OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
        OD_VELA_WEB_URL: fixture.urls.web, OD_COLLAB_TRANSPORT: 'off',
        OD_RESOURCE_TRANSPORT: 'off', OD_TEAM_PROJECTS_TRANSPORT: 'off' };
      const runPosts: Array<{ url: string; method: string }> = [];
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
          runPosts.push({ url: request.url(), method: request.method() });
      });
      let started = false;
      try {
        await suite.startWeb(env);
        started = true;
        await warmPlaywrightWebRuntime(suite.url.web('/'));
        await warmPlaywrightDaemonRuntime(suite.url.daemon('/api/health'));
        const selection = { workspaceId: space.workspaceId, workspaceMemberId: actor.memberId };
        await page.addInitScript(({ config, selection }) => {
          localStorage.setItem('open-design:config', JSON.stringify(config));
          localStorage.setItem('open-design:locale', 'zh-CN');
          localStorage.setItem('open-design:locale-source', 'manual');
          sessionStorage.setItem('od.workspaceSelection.v1', JSON.stringify(selection));
        }, { config, selection });
        await page.goto(suite.url.web('/'), { waitUntil: 'domcontentloaded' });
        const input = page.getByTestId('home-hero-input');
        await expect(input).toBeVisible({ timeout: T.xlong });
        const draft = `RUN004 ${scenario.role} original draft ${fixture.prefix}`;
        await input.fill(draft);
        await expect(page.getByTestId('home-hero-submit')).toBeEnabled();
        await page.getByTestId('home-hero-submit').click();
        const modal = scenario.kind === 'owner'
          ? page.getByTestId('amr-balance-dialog')
          : page.getByRole('dialog', { name: '团队额度不足' });
        await expect(modal).toBeVisible({ timeout: T.xlong });
        await info.attach(`${scenario.role}-real-browser-denial`, { body: await page.screenshot(), contentType: 'image/png' });
        if (scenario.kind === 'owner') {
          await expect(modal).not.toContainText('自动充值');
          const plans = modal.getByTestId('amr-balance-dialog-plans');
          if (scenario.cta) {
            await expect(plans).toBeVisible();
            const popupPromise = page.waitForEvent('popup');
            await plans.click();
            const popup = await popupPromise;
            await expect.poll(() => popup.url()).toContain('billing=plan');
            expect(new URL(popup.url()).searchParams.get('workspaceId')).toBe(space.workspaceId);
            await info.attach(`${scenario.role}-plan-url`, { body: popup.url(), contentType: 'text/plain' });
            await popup.close();
          } else await expect(plans).toHaveCount(0);
        } else {
          await expect(modal).toContainText('联系团队空间所有者');
          await expect(modal.getByTestId('amr-balance-dialog-plans')).toHaveCount(0);
        }
        expect(runPosts, 'Denied send must not create a run').toHaveLength(0);
        await modal.getByRole('button', { name: /知道了|稍后|关闭/ }).first().click();
        await expect(modal).toBeHidden();
        await expect(input).toHaveText(draft);
        await info.attach(`${scenario.role}-real-browser-after-dismiss`, { body: await page.screenshot(), contentType: 'image/png' });
        await info.attach(`${scenario.role}-real-browser-observation`, { body: JSON.stringify({
          role: scenario.role, workspaceId: space.workspaceId, memberId: actor.memberId, model: scenario.model,
          planTier: space.tier, runPosts, draftPreserved: true, planCta: scenario.cta,
          runtime: { daemon: suite.daemonUrl, web: suite.webUrl },
        }, null, 2), contentType: 'application/json' });
      } finally {
        if (started) await suite.stopWeb(env).catch(() => undefined);
        if (info.status === info.expectedStatus) await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }
});
