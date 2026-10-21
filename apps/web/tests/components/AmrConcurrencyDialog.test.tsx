// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildWorkspacePermissions } from '@open-design/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { AmrConcurrencyDialog } from '../../src/components/AmrConcurrencyDialog';
import { resolveAmrBalanceBranch } from '../../src/runtime/amr-balance-branch';
import { workspaceContextFixture } from '../helpers/workspace-context';

vi.mock('../../src/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/i18n')>();
  return { ...actual, useT: () => actual.tForLanguageTag('en')! };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['free', 'go', 'plus', 'pro', 'max'].flatMap((tier) =>
  (['owner', 'admin', 'member'] as const).map((role) => ({ tier, role }))))(
  '$tier / $role uses existing upgrade or wait/contact Owner actions, never recharge',
  ({ tier, role }) => {
    const context = workspaceContextFixture({
      workspaceId: 'billing-space', workspaceMemberId: `sender-${role}`, role,
      planId: tier === 'free' ? null : `team_${tier}`,
      permissions: buildWorkspacePermissions({ role, lifecycleState: 'active' }),
    });
    const open = vi.fn(); vi.stubGlobal('open', open);
    const onClose = vi.fn();
    render(<AmrConcurrencyDialog branch={resolveAmrBalanceBranch({ context })}
      workspaceContext={context} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(role === 'owner' && tier !== 'max'
      ? 'Concurrency limit reached' : 'Concurrent request limit reached');
    if (role !== 'owner' || tier === 'max') expect(dialog).toHaveTextContent('manually');
    expect(dialog.textContent).not.toMatch(/recharge|auto.?recharge/i);
    if (role !== 'owner') expect(dialog).toHaveTextContent('workspace Owner');
    const upgrade = screen.queryByTestId('amr-concurrency-upgrade');
    if (role === 'owner' && tier !== 'max') {
      expect(upgrade).toBeTruthy(); fireEvent.click(upgrade!);
      expect(open).toHaveBeenCalledOnce();
      expect(String(open.mock.calls[0]![0])).toContain('billing=plan');
    } else {
      expect(upgrade).toBeNull(); expect(open).not.toHaveBeenCalled();
    }
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('amr-concurrency-close'));
    expect(onClose).toHaveBeenCalledOnce();
  },
);

// Current QA UISTATE-F04-CLIENT: use the original illustration and the four
// approved Cloud benefits, with manual close/upgrade actions.
it('renders the complete F04 design for a paid upgradable Owner', () => {
  const context = workspaceContextFixture({ workspaceId: 'f04-billing-space', workspaceMemberId: 'f04-owner',
    role: 'owner', planId: 'team_pro',
    permissions: buildWorkspacePermissions({ role: 'owner', lifecycleState: 'active' }) });
  render(<AmrConcurrencyDialog branch={resolveAmrBalanceBranch({ context })}
    workspaceContext={context} onClose={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelector('img')).toHaveAttribute('src', '/upgrade/cloud-signin-aurora.jpg');
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(dialog).toHaveTextContent('Invite members for free and share allowance');
  expect(screen.getByTestId('amr-concurrency-close')).toHaveTextContent('Not now');
  expect(screen.getByTestId('amr-concurrency-upgrade')).toHaveTextContent('Upgrade plan');
});
