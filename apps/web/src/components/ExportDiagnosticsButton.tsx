import { exportDiagnostics } from '../runtime/diagnostics-export';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { captureAndUploadChatScrollForensics } from '../observability/chat-scroll-forensics';

const STATUS_CLEAR_MS = 6000;

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

/**
 * The one diagnostics-export mechanism, shared by every surface that offers it.
 *
 * It used to live inside the Settings row, which is why "export the logs" was a
 * Settings-only capability while the error card could offer nothing but a
 * clipboard copy. The behavior (native save dialog under Electron, browser
 * download otherwise) belongs to the capability, not to one panel — so any new
 * entry point reuses this instead of re-implementing the download.
 */
export function useDiagnosticsExport() {
  const t = useT();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
  }, []);

  const scheduleClear = () => {
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setStatus({ kind: 'idle' }), STATUS_CLEAR_MS);
  };

  const handleClick = async () => {
    if (status.kind === 'busy') return;
    setStatus({ kind: 'busy' });
    // Hand the daemon the renderer-side chat-scroll scene BEFORE asking it to
    // build the bundle. The zip is assembled in the daemon, which cannot read
    // the renderer's DOM, computed styles, running animations or the freeze
    // probe's state — so the only way any of that reaches the file the user
    // sends us is to push it across first and let the export drain it.
    //
    // Awaited on purpose: the export request must not overtake the evidence it
    // is supposed to carry. It never throws and never fails the export.
    await captureAndUploadChatScrollForensics();
    try {
      const result = await exportDiagnostics();
      if (result.ok) {
        setStatus({ kind: 'success', message: t('diagnostics.exportSuccess').replace('{path}', result.path) });
      } else if (result.cancelled) {
        setStatus({ kind: 'idle' });
        return;
      } else {
        setStatus({ kind: 'error', message: t('diagnostics.exportFailed').replace('{message}', result.message) });
      }
      scheduleClear();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ kind: 'error', message: t('diagnostics.exportFailed').replace('{message}', message) });
      scheduleClear();
    }
  };

  return { status, busy: status.kind === 'busy', run: handleClick };
}

/**
 * Designed for the Settings → About panel. Renders a labeled button with a
 * short status line below it. Works in both the Electron shell (uses native
 * save dialog through the selected export implementation) and the browser (triggers a
 * browser download via the daemon HTTP endpoint).
 */
export function ExportDiagnosticsRow() {
  const t = useT();
  const { status, busy, run: handleClick } = useDiagnosticsExport();
  return (
    <div className="diagnostics-export-row">
      <button
        type="button"
        className="ghost diagnostics-export-button"
        onClick={() => void handleClick()}
        disabled={busy}
        data-status={status.kind}
      >
        <Icon name="download" size={14} />
        <span>{busy ? t('diagnostics.exporting') : t('diagnostics.exportButton')}</span>
      </button>
      {status.kind === 'success' || status.kind === 'error' ? (
        <p className={`diagnostics-export-status ${status.kind}`} role="status">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
