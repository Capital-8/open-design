import { triggerHrefDownload } from './shared';
import type { DownloadExportResult } from '../exports/shared';

export async function saveExportDownload(
  blob: Blob,
  filename: string,
): Promise<DownloadExportResult> {
  const url = URL.createObjectURL(blob);
  try {
    triggerHrefDownload(url, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'download';
}
