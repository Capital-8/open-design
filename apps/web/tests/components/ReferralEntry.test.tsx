// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { ReferralEntry, ReferralEntryProvider } from '../../src/components/ReferralEntry';

const open = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/providers/registry', () => ({ openExternalUrl: open }));
vi.mock('../../src/runtime/amr-guidance', () => ({ amrConsoleUrlForProfile: () => 'https://example.test/cloud/dashboard?source=open_design&campaign=x' }));
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; vi.clearAllMocks(); });

it('shows an active campaign and opens the current environment activity page', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ campaignStatus: 'active' }))) as typeof fetch;
  render(<I18nProvider initial="zh-CN"><ReferralEntryProvider accountId="a" profile="test"><ReferralEntry /></ReferralEntryProvider></I18nProvider>);
  fireEvent.click(await screen.findByTestId('referral-entry'));
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/cloud/reset?source=open_design&campaign=x'));
});

it('hides the entry when the activity is ended or the account changes before a new response', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ campaignStatus: 'active' }))) as typeof fetch;
  const { rerender } = render(<I18nProvider initial="en"><ReferralEntryProvider accountId="a" profile="test"><ReferralEntry /></ReferralEntryProvider></I18nProvider>);
  await screen.findByTestId('referral-entry');
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ campaignStatus: 'ended' }))) as typeof fetch;
  rerender(<I18nProvider initial="en"><ReferralEntryProvider accountId="b" profile="test"><ReferralEntry /></ReferralEntryProvider></I18nProvider>);
  expect(screen.queryByTestId('referral-entry')).toBeNull();
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  expect(screen.queryByTestId('referral-entry')).toBeNull();
});
