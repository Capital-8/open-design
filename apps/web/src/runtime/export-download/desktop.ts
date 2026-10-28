import { subscribeHostDownloads } from '@open-design/host';
import { triggerHrefDownload } from './shared';
import type { DownloadExportResult } from '../exports/shared';

/** Keep the native save result associated with this exact blob, including cancellation. */
export async function saveExportDownload(
  blob: Blob,
  filename: string,
): Promise<DownloadExportResult> {
  const url = URL.createObjectURL(blob);
  let unsubscribe: (() => void) | null = null;
  const completion = new Promise<DownloadExportResult>((resolve, reject) => {
    unsubscribe = subscribeHostDownloads((result) => {
      if (result.url !== url) return;
      if (result.state === 'interrupted') reject(new Error('Export download interrupted'));
      else resolve(result.state === 'completed' ? 'desktop' : 'cancelled');
    });
    if (!unsubscribe) resolve('download');
  });
  try {
    triggerHrefDownload(url, filename);
    return await completion;
  } finally {
    if (unsubscribe) {
      (unsubscribe as () => void)();
      URL.revokeObjectURL(url);
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}
