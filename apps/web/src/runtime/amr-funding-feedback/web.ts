import type { FundingFeedbackApi } from './types';

// Displayed wallet data is advisory. Admission belongs to the server; unknown
// never fabricates a positive balance, and there is no local admission cache.
export const cachedHomeAmrFundingBlock: FundingFeedbackApi['cachedHomeAmrFundingBlock'] = () => null;
export const checkAmrFundingFeedback: FundingFeedbackApi['checkAmrFundingFeedback'] = async () => 'unknown';
export const invalidateAmrFundingFeedback: FundingFeedbackApi['invalidateAmrFundingFeedback'] = () => {};
