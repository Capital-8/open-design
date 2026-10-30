import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { WorkspaceCollabContext } from '@open-design/contracts';

import { useT } from '../../i18n';
import { exportProjectAsZip } from '../../runtime/exports';
import { shareProjectToTeam } from '../../state/projectShareRequest';
import { RemixIcon } from '../RemixIcon';
import { DeleteMark, RenameMark } from './RailRecentMarks';

/** The project actions popup, positioned beside its row in the document layer. */
export function RailRecentMenu({
  projectId,
  projectName,
  workspaceContext,
  anchor,
  rowRef,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  projectId: string;
  projectName: string;
  workspaceContext?: WorkspaceCollabContext | null;
  anchor: { top: number; left: number };
  rowRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onRename?: () => void;
  onDuplicate?: () => void | Promise<void>;
  onDelete?: () => boolean | void | Promise<boolean | void>;
  onOpen?: () => void | Promise<unknown>;
}) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    function onDocPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rowRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // The anchor is a snapshot of the row's position. Dismiss when it moves.
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, rowRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      className="entry-nav-rail__recent-menu"
      role="menu"
      style={{ top: anchor.top, left: anchor.left }}
    >
      {onRename ? (
        <button type="button" role="menuitem" onClick={() => { onClose(); onRename(); }}>
          <RenameMark />
          <span>{t('designs.menuRename')}</span>
        </button>
      ) : null}
      {onDuplicate ? (
        <button type="button" role="menuitem" onClick={() => { onClose(); void onDuplicate(); }}>
          <RemixIcon name="file-copy-line" size={14} />
          <span>{t('workspace.copyProject')}</span>
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          void shareProjectToTeam(projectId, workspaceContext).then((shared) => {
            if (!shared) void onOpen?.();
          });
        }}
      >
        <RemixIcon name="share-forward-line" size={14} />
        <span>{t('workspace.shareToTeam')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          void exportProjectAsZip({
            projectId,
            filePath: '',
            fallbackHtml: '',
            fallbackTitle: projectName,
            workspaceContext,
          });
        }}
      >
        <RemixIcon name="download-line" size={14} />
        <span>{t('preview.exportMenu')}</span>
      </button>
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          className={confirmingDelete ? 'is-danger' : undefined}
          onClick={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              return;
            }
            onClose();
            void onDelete();
          }}
        >
          <DeleteMark />
          <span>{confirmingDelete ? t('designs.renameSave') : t('designs.menuDelete')}</span>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
