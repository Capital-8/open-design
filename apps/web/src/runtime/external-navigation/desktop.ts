import { isOpenDesignHostAvailable, openHostExternalUrl } from '@open-design/host';
import { bridgeFirstPartyUrl, openBrowserExternalUrl } from './shared';
export async function openExternalUrl(url: string): Promise<boolean> {
  const targetUrl = (await bridgeFirstPartyUrl(url)) ?? url;
  if (isOpenDesignHostAvailable()) {
    const result = await openHostExternalUrl(targetUrl);
    if (result.ok) return true;
  }
  return openBrowserExternalUrl(targetUrl);
}
