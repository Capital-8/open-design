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
import { exportAsZip } from './shared';
import { captureHostPage, printHostPdf, isOpenDesignHostAvailable } from '@open-design/host';
import { buildSrcdoc, type SrcdocOptions } from '../srcdoc';
import { randomUUID } from '../../utils/uuid';
import {
  exportBrowserPdf,
  buildSandboxedPreviewDocument,
  injectDeckPrintStylesheet,
  injectPrintReadyHandshake,
  injectParentPrintReadyCache,
  downloadImageDataUrl,
} from './shared';
import type {
  PreviewSnapshot,
  ExportProgress,
  ImageExportTarget,
  ImageExportFormat,
} from './shared';

export async function exportProjectAsPdf(
  opts: ProjectPdfExportOptions,
): Promise<ProjectPdfExportResult> {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(opts.projectId)}/export/pdf`, {
      body: JSON.stringify({
        deck: opts.deck,
        fileName: opts.filePath,
        title: opts.title,
        ...(opts.versionId ? { versionId: opts.versionId } : {}),
      }),
      headers: {
        'content-type': 'application/json',
        ...(opts.workspaceContext ? workspaceProjectHeaders(opts.workspaceContext) : {}),
      },
      method: 'POST',
    });
    if (!resp.ok) throw new Error(`desktop PDF export unavailable (${resp.status})`);
    const body = await resp.json().catch(() => ({}));
    if (body?.canceled === true) return 'cancelled';
    if (body?.ok !== true) throw new Error(body?.error || 'desktop PDF export failed');
    return 'desktop';
  } catch (err) {
    console.warn('[exportProjectAsPdf] falling back to programmatic PDF:', err);
    await opts.fallbackPdf();
    return 'fallback';
  }
}

// A local daemon without an Electron host cannot provide off-screen rendering.
export function canRenderProjectImage(): boolean {
  return isOpenDesignHostAvailable();
}
function classifyUnavailable(
  response: Response,
): Extract<ProjectScreenshotExportResult, { unavailable: true }> | null {
  return response.status === 501 ? { ok: false, unavailable: true, reason: 'no-renderer' } : null;
}
export function exportProjectAsZip(opts: ProjectZipExportOptions): Promise<DownloadExportResult> {
  return requestProjectArchive(opts, async (error) => {
    console.warn('[exportProjectAsZip] falling back to single-file ZIP:', error);
    return exportAsZip(opts.fallbackHtml, opts.fallbackTitle);
  });
}
export async function exportProjectAsMp4(
  _opts: ProjectMp4ExportOptions,
): Promise<DownloadExportResult> {
  throw new Error('Project MP4 export is unavailable in this desktop export pipeline');
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

/**
 * Capture a rectangle of the on-screen window via the desktop host's
 * compositor (Electron `webContents.capturePage`). Unlike the in-iframe
 * SVG-foreignObject bridge, this returns the REAL rendered pixels — fonts,
 * external CSS, gradients, cross-origin images and embedded <webview> content
 * all paint faithfully and the canvas is never tainted, so it cannot produce
 * the black/blank frames the foreignObject path does. Returns null when no
 * desktop host is present (pure web), so callers fall back to the bridge.
 *
 * `clipRect` is in CSS pixels relative to the viewport (e.g. an iframe's
 * getBoundingClientRect()); capturePage expects DIP page coordinates, which
 * match 1:1 for the top-level window (it never scrolls).
 */
export async function captureHostRegionSnapshot(
  clipRect: { left: number; top: number; width: number; height: number } | null,
): Promise<PreviewSnapshot | null> {
  if (!isOpenDesignHostAvailable()) return null;
  const clip =
    clipRect && clipRect.width >= 1 && clipRect.height >= 1
      ? {
          x: Math.max(0, Math.round(clipRect.left)),
          y: Math.max(0, Math.round(clipRect.top)),
          width: Math.max(1, Math.round(clipRect.width)),
          height: Math.max(1, Math.round(clipRect.height)),
        }
      : undefined;
  try {
    const result = await captureHostPage(clip ? { clip } : undefined);
    if (result.ok && result.dataUrl && result.w >= 1 && result.h >= 1) {
      return { dataUrl: result.dataUrl, w: result.w, h: result.h };
    }
  } catch {
    /* fall through to null so the caller can use the bridge */
  }
  return null;
}

/**
 * Capture an iframe's on-screen region through the desktop compositor.
 * Convenience wrapper over captureHostRegionSnapshot using the iframe's
 * current bounding rect.
 */
export async function captureHostIframeSnapshot(
  iframe: HTMLIFrameElement | null,
): Promise<PreviewSnapshot | null> {
  if (!iframe) return null;
  const rect = iframe.getBoundingClientRect();
  return captureHostRegionSnapshot({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

export async function exportAsPdf(
  html: string,
  title: string,
  opts?: SrcdocOptions & { sandboxedPreview?: boolean; onProgress?: ExportProgress },
): Promise<void> {
  if (!isOpenDesignHostAvailable()) return exportBrowserPdf(html, title, opts);
  const sandboxedPreview = opts?.sandboxedPreview ?? true;
  const nonce = randomUUID();
  let doc = buildSrcdoc(html, opts);
  if (opts?.deck) doc = injectDeckPrintStylesheet(doc);
  doc = injectPrintReadyHandshake(doc, nonce);
  if (sandboxedPreview) doc = buildSandboxedPreviewDocument(doc, title);
  doc = injectParentPrintReadyCache(doc, nonce);
  try {
    const result = await printHostPdf(doc, nonce, opts?.deck ? { deck: true } : undefined);
    if (result.ok) return;
  } catch {
    /* Preserve the native failure UI; do not start a second export. */
  }
  if (typeof alert !== 'undefined')
    alert('Print failed. Please try Export PDF again or use the browser version.');
}

/** Prefer the native screenshot renderer; only unavailability permits fallback. */
export async function exportPreviewPdf(
  opts: ProjectPdfExportOptions,
): Promise<ProjectPdfExportResult | undefined> {
  if (isOpenDesignHostAvailable()) {
    const result = await exportProjectScreenshotPdf({
      projectId: opts.projectId,
      fileName: opts.filePath,
      title: opts.title,
      deck: opts.deck,
      versionId: opts.versionId,
      workspaceContext: opts.workspaceContext,
    });
    if (result.ok) return result.completion;
    if (!('unavailable' in result)) throw new Error(result.error);
  }
  return exportProjectAsPdf(opts);
}

export async function saveImageExport(
  target: ImageExportTarget,
  blob: Blob,
  format: ImageExportFormat,
  dataUrl: string,
): Promise<void | DownloadExportResult> {
  if (!isOpenDesignHostAvailable() && target.method === 'download' && format === 'png' && dataUrl) {
    downloadImageDataUrl(dataUrl, target.filename);
    return;
  }
  return target.save(blob);
}
