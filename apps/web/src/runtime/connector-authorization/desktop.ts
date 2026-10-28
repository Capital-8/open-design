import { isOpenDesignHostAvailable, openHostExternalUrl } from '@open-design/host';
import { createBrowserConnectorAuthorization } from './browser';
import type { ConnectorAuthorization } from './types';
export function createConnectorAuthorization(
  openExternalUrl: (url: string) => Promise<boolean>,
): ConnectorAuthorization {
  if (!isOpenDesignHostAvailable()) return createBrowserConnectorAuthorization(openExternalUrl);
  return {
    loading() {},
    info() {},
    error() {},
    redirect: async (url) => (await openHostExternalUrl(url)).ok,
  };
}
