import type {
  ProjectPdfExportOptions,
  ProjectPdfExportResult,
  ProjectMp4ExportOptions,
  ProjectZipExportOptions,
  ProjectScreenshotExportOptions,
  ProjectImageExportOptions,
  ProjectScreenshotPdfOptions,
} from './types';
import type {
  ProjectScreenshotExportResult,
  ProjectImageExportResult,
  DownloadExportResult,
} from './shared';
import { requestProjectArchive, requestProjectScreenshot, requestProjectImage } from './shared';
import { workspaceProjectHeaders } from '../../collab/workspace-identity';
import { safeFilename, triggerDownload, filenameFromContentDisposition } from './shared';
import { downloadImageDataUrl } from './shared';
import type { PreviewSnapshot, ImageExportTarget, ImageExportFormat } from './shared';

export async function exportProjectAsPdf(
  opts: ProjectPdfExportOptions,
): Promise<ProjectPdfExportResult> {
  const resp = await fetch(`/api/projects/${encodeURIComponent(opts.projectId)}/export/pdf`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.workspaceContext ? workspaceProjectHeaders(opts.workspaceContext) : {}),
    },
    body: JSON.stringify({
      fileName: opts.filePath,
      title: opts.title,
      deck: opts.deck,
      ...(opts.versionId ? { versionId: opts.versionId } : {}),
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!resp.ok) throw new Error(`Cloud PDF export failed (${resp.status})`);
  if (!resp.headers.get('content-type')?.includes('application/pdf'))
    throw new Error('Cloud export did not return a PDF');
  const bytes = await resp.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('Cloud export returned invalid PDF data');
  const filename =
    filenameFromContentDisposition(resp) ?? `${safeFilename(opts.title, 'artifact')}.pdf`;
  triggerDownload(
    new Blob([bytes], { type: 'application/pdf' }),
    filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
  );
  return 'download';
}
export async function exportProjectAsMp4(
  opts: ProjectMp4ExportOptions,
): Promise<DownloadExportResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(opts.projectId)}/export/mp4`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(310000)])
      : AbortSignal.timeout(310000),
    body: JSON.stringify({ fileName: opts.fileName, title: opts.title }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message || body?.message || `MP4 export failed (${response.status})`,
    );
  }
  if (!response.headers.get('content-type')?.includes('video/mp4'))
    throw new Error('Invalid MP4 response');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 12 ||
    bytes.length > 20 * 1024 * 1024 ||
    String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp'
  )
    throw new Error('Invalid MP4 file');
  opts.signal?.throwIfAborted();
  triggerDownload(
    new Blob([bytes], { type: 'video/mp4' }),
    `${safeFilename(opts.title, 'motion')}.mp4`,
  );
  return 'download';
}

// Cloud rendering is a server capability and does not require an Electron host.
export function canRenderProjectImage(): boolean {
  return true;
}
// A cloud 501 is a semantic source/history error; keep the server's details.
function classifyUnavailable(): null {
  return null;
}
export function exportProjectAsZip(opts: ProjectZipExportOptions): Promise<DownloadExportResult> {
  return requestProjectArchive(opts, async (error) => {
    throw error;
  });
}

export function exportProjectAsPptx(
  opts: ProjectScreenshotExportOptions,
): Promise<ProjectScreenshotExportResult> {
  return requestProjectScreenshot(opts, classifyUnavailable);
}
export function exportProjectImageDataUrl(
  opts: ProjectImageExportOptions,
): Promise<ProjectImageExportResult> {
  return requestProjectImage(opts, classifyUnavailable);
}
export function exportProjectScreenshotPdf(
  opts: ProjectScreenshotPdfOptions,
): Promise<ProjectScreenshotExportResult> {
  return exportProjectAsPptx({ ...opts, format: 'pdf' });
}

export { exportBrowserPdf as exportAsPdf } from './shared';
export function exportPreviewPdf(
  opts: ProjectPdfExportOptions,
): Promise<ProjectPdfExportResult | undefined> {
  return exportProjectAsPdf(opts);
}
export async function captureHostRegionSnapshot(
  _rect: { left: number; top: number; width: number; height: number } | null,
): Promise<PreviewSnapshot | null> {
  return null;
}
export async function captureHostIframeSnapshot(
  _iframe: HTMLIFrameElement | null,
): Promise<PreviewSnapshot | null> {
  return null;
}
export async function saveImageExport(
  target: ImageExportTarget,
  blob: Blob,
  format: ImageExportFormat,
  dataUrl: string,
): Promise<void | DownloadExportResult> {
  if (target.method === 'download' && format === 'png' && dataUrl) {
    downloadImageDataUrl(dataUrl, target.filename);
    return;
  }
  return target.save(blob);
}
