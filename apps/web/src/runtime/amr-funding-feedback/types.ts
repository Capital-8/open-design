import type { AmrWalletSnapshot } from '@open-design/contracts';
import type { AmrBalanceGateScope } from '../amr-balance-gate';
export type FundingFeedback = 'available' | 'insufficient' | 'unknown';
export interface FundingFeedbackApi {
  cachedHomeAmrFundingBlock(scope: AmrBalanceGateScope | undefined, modelId: string | null, memorySnapshot?: AmrWalletSnapshot | null): AmrWalletSnapshot | null;
  checkAmrFundingFeedback(scope: AmrBalanceGateScope | undefined, modelId: string | null, isCurrent?: () => boolean): Promise<FundingFeedback>;
  invalidateAmrFundingFeedback(): void;
}
