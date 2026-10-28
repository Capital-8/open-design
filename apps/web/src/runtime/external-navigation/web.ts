import { bridgeFirstPartyUrl, openBrowserExternalUrl } from './shared';
export async function openExternalUrl(url: string): Promise<boolean> {
  return openBrowserExternalUrl((await bridgeFirstPartyUrl(url)) ?? url);
}
