import type { DiagnosticsExportResult } from './types';
const DIAGNOSTICS_EXPORT_PATH = '/api/diagnostics/export';
const DIAGNOSTICS_FILENAME_PREFIX = 'open-design-diagnostics';
function fileNameFromHeader(header: string | null): string | null {
  if (header == null) return null;
  const match = /filename\*=UTF-8''([^;\n]+)|filename="([^"]+)"|filename=([^;\n]+)/i.exec(header);
  if (match == null) return null;
  const raw = match[1] ?? match[2] ?? match[3];
  if (raw == null) return null;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

function fallbackFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${DIAGNOSTICS_FILENAME_PREFIX}-${stamp}.zip`;
}

export async function exportDiagnostics(): Promise<DiagnosticsExportResult> {
  const res = await fetch(DIAGNOSTICS_EXPORT_PATH, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body.message === 'string') message = body.message;
    } catch {
      // ignore body parse errors
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = fileNameFromHeader(res.headers.get('content-disposition')) ?? fallbackFilename();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true, path: filename };
}
