import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import { expect, clusterTest as test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { ensureRailOpen } from '@/playwright/rail';
import { T } from '@/timeouts';
import { createCollabCluster } from '@/playwright/collab-cluster';
import { startFakeCollabHub } from '@/playwright/fake-collab-hub';

const OWNER = {
  controlKey: 'personal-sharing-owner-key',
  memberId: 'personal-sharing-owner',
  name: 'Personal Sharing Owner',
  role: 'owner' as const,
};
const SECOND = {
  controlKey: 'personal-sharing-second-key',
  memberId: 'personal-sharing-second',
  name: 'Second Personal Owner',
  role: 'owner' as const,
};
const personalWorkspaceId = `personal-${OWNER.memberId}`;
const personalWorkspaceMemberId = `personal-member-${OWNER.memberId}`;
const personalHeaders = {
  'x-od-workspace-id': personalWorkspaceId,
  'x-od-workspace-type': 'personal',
  'x-od-workspace-member-id': personalWorkspaceMemberId,
  'x-od-workspace-role': 'owner',
  'x-od-workspace-member-status': 'active',
  'x-od-workspace-lifecycle-state': 'active',
  'x-od-workspace-can-share-projects': 'true',
  'x-od-workspace-can-write-synced-files': 'true',
};

test('[P1] Personal workspace owner shares a private project and takes it back through browser controls', async ({ browser }, testInfo) => {
  const projectId = randomUUID();
  const projectName = `Personal sharing browser ${projectId.slice(0, 8)}`;
  const hubRoot = testInfo.outputPath('personal-sharing-hub');
  await mkdir(hubRoot, { recursive: true });
  const hub = await startFakeCollabHub({
    root: hubRoot,
    workspaceId: 'personal-sharing-team-fixture',
    workspaceName: 'Unused team fixture',
    clients: [OWNER, SECOND],
    includePersonalWorkspace: true,
  });
  const velaBin = await hub.writeVelaBin(testInfo.outputPath('fake-vela-personal-sharing'));
  const commonEnv = {
    OD_COLLAB_TRANSPORT: 'vela-cli',
    OD_RESOURCE_TRANSPORT: 'vela-cli',
    OD_TEAM_PROJECTS_TRANSPORT: 'vela-cli',
    OD_WORKSPACE_CONTEXT_SOURCE: 'vela',
    VELA_API_URL: hub.url,
    VELA_BIN: velaBin,
  };
  let cluster: Awaited<ReturnType<typeof createCollabCluster>> | undefined;
  let failed = false;
  try {
    cluster = await createCollabCluster(browser, testInfo, [
      { id: 'owner', env: { ...commonEnv, VELA_CONTROL_KEY: OWNER.controlKey } },
      { id: 'second', env: { ...commonEnv, VELA_CONTROL_KEY: SECOND.controlKey } },
    ]);
    const page = cluster.clients.owner!.page;
    await applyStandardMocks(page);
    await page.route('**/api/design-templates', (route) => route.fulfill({ json: { designTemplates: [] } }));
    await page.route('**/api/design-systems', (route) => route.fulfill({ json: { designSystems: [] } }));
    const active = await page.request.put('/api/workspace/active', {
      data: { workspaceId: personalWorkspaceId, workspaceMemberId: personalWorkspaceMemberId },
      timeout: T.long,
    });
    expect(active.ok(), `activate workspace: ${await active.text()}`).toBe(true);

    const created = await page.request.post('/api/projects', {
      headers: personalHeaders,
      data: {
        id: projectId,
        name: projectName,
        skillId: null,
        designSystemId: null,
        metadata: { kind: 'prototype', nameSource: 'user' },
      },
    });
    expect(created.ok(), `create project: ${await created.text()}`).toBe(true);

    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
    await ensureRailOpen(page);
    await page.getByTestId('entry-nav-drafts').click();

    const personalTab = page.getByTestId('recent-projects-collection-personalProjects');
    const teamTab = page.getByTestId('recent-projects-collection-teamProjects');
    const card = page.locator(`.recent-projects__card[data-project-id="${projectId}"]`);
    await expect(teamTab).toBeVisible({ timeout: T.long });
    await personalTab.click();
    await expect(card).toBeVisible();
    await teamTab.click();
    await expect(card).toHaveCount(0);

    await personalTab.click();
    await card.getByRole('button', { name: 'More actions' }).click();
    await card.getByRole('menuitem', { name: 'Move to team space' }).click();
    const shareResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/projects/${projectId}/move`),
    );
    await page.getByRole('alertdialog', { name: 'Move to team space' })
      .getByRole('button', { name: 'Confirm move' }).click();
    const shared = await shareResponse;
    expect(shared.ok(), `share: ${shared.status()} ${await shared.text()}`).toBe(true);

    await expect(card).toHaveCount(0);
    await teamTab.click();
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-shared/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await teamTab.click();
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-shared/);

    await card.getByRole('button', { name: 'More actions' }).click();
    await card.getByRole('menuitem', { name: 'Move out of team space' }).click();
    const unshareResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/projects/${projectId}/move`),
    );
    await page.getByRole('alertdialog', { name: 'Move out of team space' })
      .getByRole('button', { name: 'Confirm move' }).click();
    const unshared = await unshareResponse;
    expect(unshared.ok(), `unshare: ${unshared.status()} ${await unshared.text()}`).toBe(true);

    await expect(card).toHaveCount(0);
    await personalTab.click();
    await expect(card).toBeVisible();
    await expect(card).not.toHaveClass(/is-shared/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await personalTab.click();
    await expect(card).toBeVisible();
    await expect(card).not.toHaveClass(/is-shared/);
  } catch (error) {
    failed = true;
    await testInfo.attach('fake-collab-commands', {
      body: JSON.stringify({ commands: hub.commandLog, requests: hub.requestLog }, null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await cluster?.close({ preserve: failed });
    await hub.close();
  }
});
