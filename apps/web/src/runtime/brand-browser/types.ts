export interface BrowserAttentionRequest {
  tabId: string;
  url: string;
  nonce: number;
  focusOnly?: boolean;
  attentionAction?: 'download-page';
}
export type BrowserFocus = (request: BrowserAttentionRequest) => void;
