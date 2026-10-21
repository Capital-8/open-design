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

// SAFE-004: the upgrade must stay in the current runtime and paying workspace.
it.each([
  ['local', 'http://localhost:5173'],
  ['test', 'https://open-design.powerformer.net'],
  ['prod', 'https://open-design.ai'],
] as const)('keeps the %s concurrency upgrade in the rejected workspace', (profile, origin) => {
  const context = workspaceContextFixture({ workspaceId: 'funding-space-a', workspaceMemberId: 'owner-a',
    role: 'owner', planId: 'team_pro', permissions: buildWorkspacePermissions({ role: 'owner', lifecycleState: 'active' }) });
  const open = vi.fn(); vi.stubGlobal('open', open);
  render(<AmrConcurrencyDialog branch={resolveAmrBalanceBranch({ context })}
    workspaceContext={context} profile={profile} onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('amr-concurrency-upgrade'));
  const target = new URL(open.mock.calls[0]![0]);
  expect(target.origin).toBe(origin);
  expect(target.searchParams.get('workspaceId')).toBe('funding-space-a');
  expect(target.searchParams.get('billing')).toBe('plan');
});

it('changes the upgrade target with the rejected workspace without inheriting the old one', () => {
  const makeContext = (workspaceId: string) => workspaceContextFixture({ workspaceId, workspaceMemberId: `owner-${workspaceId}`,
    role: 'owner', planId: 'team_pro', permissions: buildWorkspacePermissions({ role: 'owner', lifecycleState: 'active' }) });
  const contextA = makeContext('funding-space-a');
  const contextB = makeContext('funding-space-b');
  const open = vi.fn(); vi.stubGlobal('open', open);
  const view = render(<AmrConcurrencyDialog branch={resolveAmrBalanceBranch({ context: contextA })}
    workspaceContext={contextA} profile="test" onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('amr-concurrency-upgrade'));
  view.rerender(<AmrConcurrencyDialog branch={resolveAmrBalanceBranch({ context: contextB })}
    workspaceContext={contextB} profile="test" onClose={vi.fn()} />);
  fireEvent.click(screen.getByTestId('amr-concurrency-upgrade'));
  expect(new URL(open.mock.calls[0]![0]).searchParams.get('workspaceId')).toBe('funding-space-a');
  expect(new URL(open.mock.calls[1]![0]).searchParams.get('workspaceId')).toBe('funding-space-b');
});

it('does not create an upgrade entrance before a workspace identity is known', () => {
  const open = vi.fn(); vi.stubGlobal('open', open);
  render(<AmrConcurrencyDialog branch={{ tier: 'below_max', audience: 'owner' }}
    workspaceContext={null} profile="local" onClose={vi.fn()} />);
  expect(screen.queryByTestId('amr-concurrency-upgrade')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
