import { MotionExportButton } from '../MotionExportButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cloudPreviewDocument } from '../../runtime/cloud-file-preview';
import { PreviewModal } from '../PreviewModal';

/** Click-only compatibility for the original client. The cookie-authenticated
 * daemon checks project ownership and reads the real Runtime file; the model's
 * filesystem path never becomes an HTTP resource or a project identifier. */
export function CloudFilePreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [document, setDocument] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  // PreviewModal calls onView on mount and on Retry. Abort stale reads when
  // retried, closed or switched to another project; never reuse another file.
  const load = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setDocument(null); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/index.html`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('html' in value) || typeof value.html !== 'string') {
          throw new Error('Invalid cloud file response');
        }
        if (!controller.signal.aborted) setDocument(cloudPreviewDocument(value.html));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Preview failed');
      }
    })();
  }, [projectId]);
  return createPortal(<PreviewModal title="index.html" exportTitleFor={() => 'index.html'}
    onClose={onClose} onView={load} views={[{
      id: 'index.html', label: 'index.html', error,
      // Use a custom stage to avoid the desktop srcdoc bridge/export pipeline:
      // it assumes local daemon assets and broader iframe permissions.
      custom: document === null ? undefined : <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <MotionExportButton source={document} projectId={projectId} fileName="index.html" title="motion" />
        <iframe title="index.html" sandbox="allow-scripts"
        referrerPolicy="no-referrer" srcDoc={document} style={{ width: '100%', height: '100%', minHeight: 0, flex: 1, border: 0 }} /></div>,
    }]} />, window.document.body);
}
