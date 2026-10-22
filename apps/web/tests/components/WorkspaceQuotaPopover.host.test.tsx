// @vitest-environment jsdom
// C-01 / E12, VIEW-001/017: real top-right host stays reachable before billing resolves.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkspaceBillingResponse, WorkspaceBillingSummary } from '@open-design/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { EntryNavRail, resetWorkspaceDirectoryCache } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';
import { workspaceContextFixture } from '../helpers/workspace-context';

afterEach(() => { cleanup(); resetWorkspaceDirectoryCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('E12 clicking the quota pill opens the skeleton without navigating or guessing zero', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const context = workspaceContextFixture({ workspaceId: 'a', workspaceMemberId: 'member-a', role: 'owner', planId: 'pro' });
  await act(async () => { render(<I18nProvider initial="zh-CN"><EntryNavRail view="home" onViewChange={() => {}} onNewProject={() => {}} open context={context} billing={null} billingResponse={null} /></I18nProvider>); });
  fireEvent.click(screen.getByTestId('entry-top-right-credits'));
  expect(screen.getByTestId('workspace-quota-skeleton')).toBeTruthy();
  expect(screen.getByTestId('entry-top-right-credits').getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByText('$0.00')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('E12 an unknown personal plan does not inherit the host legacy Free fallback (VIEW-012)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const context = workspaceContextFixture({ workspaceId: 'a', workspaceMemberId: 'member-a', role: 'owner', workspaceType: 'personal', planId: null, billingState: undefined });
  await act(async () => { render(<I18nProvider initial="zh-CN"><EntryNavRail view="home" onViewChange={() => {}} onNewProject={() => {}} open context={context} billing={null} billingResponse={null} /></I18nProvider>); });
  fireEvent.click(screen.getByTestId('entry-top-right-credits'));
  expect(screen.getByTestId('workspace-quota-skeleton')).toBeTruthy();
  expect(document.querySelector('.entry-nav-rail__menu-credits-plan .plan-wordmark')).toBeNull();
  expect(screen.queryByRole('img', { name: 'free' })).toBeNull();
});

it('E09 current workspace Free keeps its badge when account metadata says Max (VIEW-012)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const context = workspaceContextFixture({ workspaceId: 'free-a', workspaceMemberId: 'free-member', role: 'owner', workspaceType: 'personal', planId: null, billingState: 'free' });
  const account: WorkspaceBillingSummary = { workspaceId: null, membershipTier: 'max', totalAvailableCredits: 0, subscriptionCredits: 0, rechargeCredits: 0, balanceUsd: '999', subscriptionStatus: 'active', availableActions: [], workspaceBalance: null };
  const response: WorkspaceBillingResponse = { summary: account, workspaceBalance: { workspaceId: context.workspaceId, workspaceMemberId: context.workspaceMemberId, balanceUsd: '24', billingScopeVersion: 2, expiresAt: null, updatedAt: null } };
  await act(async () => { render(<I18nProvider initial="zh-CN"><EntryNavRail view="home" onViewChange={() => {}} onNewProject={() => {}} open context={context} billing={account} billingResponse={response} /></I18nProvider>); });
  fireEvent.click(screen.getByTestId('entry-top-right-credits'));
  const panel = within(screen.getByTestId('entry-top-right-credits-panel'));
  expect(panel.getByRole('img', { name: 'free' })).toBeTruthy();
  expect(panel.queryByRole('img', { name: 'max' })).toBeNull();
  expect(panel.getByText('未订阅')).toBeTruthy();
  expect(panel.getByText('$24.00')).toBeTruthy();
  expect(panel.getByRole('button', { name: '升级' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: '管理' })).toBeNull();
});
