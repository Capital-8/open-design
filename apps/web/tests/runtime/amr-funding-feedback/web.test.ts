import { afterEach, expect, it, vi } from 'vitest';
import type { AmrWalletSnapshot } from '@open-design/contracts';
import { cachedHomeAmrFundingBlock, checkAmrFundingFeedback, invalidateAmrFundingFeedback } from '../../../src/runtime/amr-funding-feedback/web';

const scope = { workspaceType: 'personal' as const, workspaceId: 'workspace', workspaceMemberId: 'member' };
afterEach(() => vi.unstubAllGlobals());

it('does not block Home using a displayed zero balance or a retained funding hint', () => {
  const retained: AmrWalletSnapshot = {
    status: 'available', profile: 'test', user: null, balanceUsd: '0', updatedAt: null,
    fetchedAt: new Date().toISOString(), stale: true, source: 'daemon_cache',
  };
  expect(cachedHomeAmrFundingBlock(scope, 'model', retained)).toBeNull();
});

it('does not request an unsupported admission endpoint or invent available funds after invalidation', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await checkAmrFundingFeedback(scope, 'model')).toBe('unknown');
  invalidateAmrFundingFeedback();
  expect(await checkAmrFundingFeedback(scope, 'model')).toBe('unknown');
  expect(fetcher).not.toHaveBeenCalled();
});
