import { getOpenDesignHost } from '@open-design/host';

// getOpenDesignHost validates the protocol version and required capabilities.
export function supportsCampaigns(): boolean {
  return getOpenDesignHost()?.client.type === 'desktop';
}
