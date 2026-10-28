import type { OpenDesignHostPreviewNavigationFailure } from '@open-design/host';
export function getLatestHostPreviewNavigationFailure(): OpenDesignHostPreviewNavigationFailure | null {
  return null;
}
export function subscribeHostPreviewNavigationFailure(
  _listener: (failure: OpenDesignHostPreviewNavigationFailure) => void,
): () => void {
  return () => {};
}
