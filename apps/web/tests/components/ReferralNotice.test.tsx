// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { ReferralNotice } from '../../src/components/ReferralNotice';
const base = {
 serverTime: new Date().toISOString(), campaignStatus: 'active', canShare: false,
 shareBlockReason: 'free', inviteUrl: null, inviterIssuedCount: 0, inviterRewardLimit: 5,
 inviteeIssuedCount: 0, availableCardCount: 0,
 invitee: { status: 'pending', purchaseDeadline: null, dueAt: new Date(Date.now() - 1000).toISOString() },
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('H02 pending notice has neither dismiss nor subscription action', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(base)));
 render(<I18nProvider initial="en"><ReferralNotice accountId="a" profile="local" active context={null} billing={null} /></I18nProvider>);
 const notice = await screen.findByTestId('referral-notice');
 expect(notice.getAttribute('data-state')).toBe('pending');
 expect(notice.querySelector('button')).toBeNull();
});
it('removes prior account pending data while the next account is still loading', async () => {
 const fetch = vi.fn(async () => Response.json(base)); vi.stubGlobal('fetch', fetch);
 const view = (id:string) => <I18nProvider initial="en"><ReferralNotice accountId={id} profile="local" active context={null} billing={null} /></I18nProvider>;
 const { rerender } = render(view('a')); await screen.findByTestId('referral-notice');
 fetch.mockImplementation(() => new Promise(() => {})); rerender(view('b'));
 expect(screen.queryByTestId('referral-notice')).toBeNull();
});
