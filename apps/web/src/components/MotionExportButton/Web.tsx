import type { MotionExportButtonProps } from './types';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { exportProjectAsMp4 } from '../../runtime/exports';

function isMotionSource(source: string | null | undefined): boolean {
  return Boolean(source && /data-composition-id\s*=/.test(source) && /data-duration\s*=/.test(source));
}

export function MotionExportButton(props: MotionExportButtonProps) {
  if (!isMotionSource(props.source)) return null;
  return <ActiveMotionExportButton {...props} />;
}

function ActiveMotionExportButton({ projectId, fileName, title, disabled = false, menu = false }: MotionExportButtonProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setBusy(false); setError(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [projectId, fileName]);
  return <>
    <button type="button" className="share-menu-item" role={menu ? 'menuitem' : undefined}
      disabled={disabled || busy} aria-busy={busy} onClick={() => {
        if (pending.current) return;
        const controller = new AbortController(); pending.current = controller;
        setBusy(true); setError(null);
        void exportProjectAsMp4({ projectId, fileName, title, signal: controller.signal })
          .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('fileViewer.exportFailedDescription')); })
          .finally(() => { if (pending.current === controller) { pending.current = null; setBusy(false); } });
      }}>
      {busy ? t('fileViewer.exportingProgress') : 'MP4'}
    </button>
    {error ? <div role="alert">{error}</div> : null}
  </>;
}
