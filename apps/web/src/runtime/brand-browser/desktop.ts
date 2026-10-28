import {
  clearHostBrowserData,
  isOpenDesignHostAvailable,
  type OpenDesignHostBrowserClearDataOptions,
  type OpenDesignHostActionResult,
} from '@open-design/host';
import type { BrowserFocus } from './types';
export async function clearBrowserData(
  options?: OpenDesignHostBrowserClearDataOptions,
): Promise<OpenDesignHostActionResult> {
  if (!isOpenDesignHostAvailable()) return { ok: false, reason: 'host-unavailable' };
  return clearHostBrowserData(options);
}
export async function readBrowserSnapshotWithRetry<T extends { status: string }>(
  read: (timeout: number) => Promise<T>,
): Promise<T> {
  let snapshot = await read(8000);
  if (!isOpenDesignHostAvailable()) return snapshot;
  for (let attempt = 0; attempt < 3 && snapshot.status !== 'ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await read(3000);
  }
  return snapshot;
}
export function canContinueInBrowser(hasLiveBrowser: boolean): boolean {
  return isOpenDesignHostAvailable() || hasLiveBrowser;
}
export async function focusBrowserForExtraction(
  url: string | null | undefined,
  tabId: string,
  focus: BrowserFocus,
): Promise<void> {
  if (!isOpenDesignHostAvailable() || !url) return;
  focus({ tabId, url, nonce: Date.now(), focusOnly: true });
  await new Promise((resolve) => setTimeout(resolve, 600));
}
export function requestBrowserArchive(
  url: string | null | undefined,
  tabId: string,
  focus: BrowserFocus,
): void {
  if (isOpenDesignHostAvailable() && url)
    focus({ tabId, url, nonce: Date.now(), attentionAction: 'download-page' });
}
