import type {
  OpenDesignHostBrowserClearDataOptions,
  OpenDesignHostActionResult,
} from '@open-design/host';
import type { BrowserFocus } from './types';
export async function clearBrowserData(
  _options?: OpenDesignHostBrowserClearDataOptions,
): Promise<OpenDesignHostActionResult> {
  return { ok: false, reason: 'host-unavailable' };
}
export function readBrowserSnapshotWithRetry<T extends { status: string }>(
  read: (timeout: number) => Promise<T>,
): Promise<T> {
  return read(8000);
}
export function canContinueInBrowser(hasLiveBrowser: boolean): boolean {
  return hasLiveBrowser;
}
export async function focusBrowserForExtraction(
  _url: string | null | undefined,
  _tabId: string,
  _focus: BrowserFocus,
): Promise<void> {}
export function requestBrowserArchive(
  _url: string | null | undefined,
  _tabId: string,
  _focus: BrowserFocus,
): void {}
