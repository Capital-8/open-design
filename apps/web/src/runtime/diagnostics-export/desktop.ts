import { exportDiagnostics as exportViaHttp } from './browser';
import type { DiagnosticsExportResult } from './types';
declare global {
  interface Window {
    openDesignDesktop?: { exportDiagnostics(): Promise<DiagnosticsExportResult> };
  }
}
export function exportDiagnostics(): Promise<DiagnosticsExportResult> {
  if (typeof window !== 'undefined' && window.openDesignDesktop)
    return window.openDesignDesktop.exportDiagnostics();
  return exportViaHttp();
}
