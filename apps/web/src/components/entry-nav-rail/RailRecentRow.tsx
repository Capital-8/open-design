// One row of the nav rail's 最近浏览过 list: the project name, a hover preview
// that floats out to the right of the rail, and a ⋮ menu.
//
// The preview reuses the SAME cover decision the projects grid renders
// (`lib/project-cover-cache`): the grid resolves a cover per (workspace,
// project, version) and stores it in a process-wide LRU, so a rail row usually
// has one already and paints instantly. When the cache misses — the user landed
// on a surface that never rendered the grid — the row resolves it once on hover
// with the cheap half of the grid's pipeline (files read + `selectProjectFileCover`)
// and writes the result back through the same key, so the grid inherits it too.
// Deliberately NOT ported: the grid's HEAD probe, deck-document preload and
// design-system special cases. Those exist to avoid a broken <img> in a large
// visible card; here a cover that fails to load simply falls back to the tinted
// glyph the same component already draws.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ProjectDisplayStatus, WorkspaceCollabContext } from '@open-design/contracts';

import { useT } from '../../i18n';
import { RailRecentItem } from './RailRecentItem';
import { MoreDotsMark } from './RailRecentMarks';
import { RailRecentMenu } from './RailRecentMenu';
import { fetchProjectFiles } from '../../providers/registry';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import {
  getProjectCoverSnapshot,
  projectCoverSnapshotKey,
  setProjectCoverSnapshot,
} from '../../lib/project-cover-cache';
import {
  projectCoverUrl,
  selectProjectFileCover,
  type ProjectCoverOverride,
} from '../project-cover';
import type { Project } from '../../types';

/** `undefined` = not resolved yet; `null` = resolved, this project has none. */
type CoverState = ProjectCoverOverride | null | undefined;

/**
 * Which row currently owns a popup, and which one (per product: 两个弹窗互斥
 * 原则 — one at a time).
 *
 * It has to be module-level rather than per-row state: the preview and the menu
 * are both PORTALLED to <body>, and a menu opened on row A stayed on screen
 * while row B painted its preview beside it, because neither row could see the
 * other's state. One claim arbitrates both kinds across every row, so opening
 * anything closes whatever was open.
 */
export type PopupClaim = { rowId: string; kind: 'preview' | 'menu' } | null;
let popupClaim: PopupClaim = null;
export const popupClaimListeners = new Set<() => void>();

export function currentPopupClaim(): PopupClaim {
  return popupClaim;
}

export function claimPopup(next: PopupClaim) {
  popupClaim = next;
  for (const listener of popupClaimListeners) listener();
}

/** Release only if this row still holds it — a later claim must not be undone
 *  by an earlier row's pointer-leave arriving afterwards. */
export function releasePopup(rowId: string, kind: 'preview' | 'menu') {
  if (popupClaim?.rowId === rowId && popupClaim.kind === kind) claimPopup(null);
}

/** Gap between the rail's right edge and the popup that hangs off it (per
 *  product: 预览的卡片左边的间距大一点). The rows are full-bleed inside the rail
 *  panel, so this is measured from the ROW's right edge — which is the panel's —
 *  and the content column starts 12px past it. 24 therefore clears the rail by a
 *  visible margin and still reads as attached to the row rather than floating
 *  loose over the page. */
export const POPUP_GAP_PX = 24;

export function RailRecentRow({
  project,
  workspaceContext,
  runStatus,
  showLeadingIcon = true,
  expanded,
  selected = false,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  /** The open project, shown as the rail's current item (an empty project
   *  folder has no conversation row to carry that state). */
  selected?: boolean;
  project: Project;
  workspaceContext?: WorkspaceCollabContext | null;
  /** This project's live run status, when it has one (per product: 如果有项目在
   *  进行，这个 icon 换成状态). Drives the leading glyph and nothing else. */
  runStatus?: ProjectDisplayStatus;
  /** Recent history is a flat list; only project folders show a leading glyph. */
  showLeadingIcon?: boolean;
  expanded?: boolean;
  onOpen?: (id: string) => void | Promise<unknown>;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => Promise<void> | void;
  onDelete?: (id: string) => Promise<boolean | void> | boolean | void;
}) {
  const t = useT();
  const snapshotKey = projectCoverSnapshotKey(
    workspaceIdentityCacheKey(workspaceContext),
    project.id,
    project.updatedAt,
  );
  const [cover, setCover] = useState<CoverState>(
    () => getProjectCoverSnapshot(snapshotKey)?.cover,
  );
  // Where the portalled preview should sit, measured off the row at hover time.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  // This row's view of the shared claim (see `claimPopup`). Both popups render
  // off it, so "one at a time" holds across rows rather than only within one.
  const [claim, setClaim] = useState<PopupClaim>(popupClaim);
  useEffect(() => {
    const listener = () => setClaim(popupClaim);
    popupClaimListeners.add(listener);
    return () => { popupClaimListeners.delete(listener); };
  }, []);
  const ownsPreview = claim?.rowId === project.id && claim.kind === 'preview';
  const menuOpen = claim?.rowId === project.id && claim.kind === 'menu';
  // The menu opens where the preview would have been (per product), which puts
  // it outside the rail — so it needs its own anchor, frozen at click time.
  // `anchor` cannot serve: it is cleared the moment the pointer leaves the row,
  // which happens on the way to the menu itself.
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      // A row that leaves (the list re-sorts, the rail closes) must not leave
      // its popup claimed, or nothing else could ever open one.
      if (popupClaim?.rowId === project.id) claimPopup(null);
    };
  }, [project.id]);

  // A newer version of the project (rename, new content) misses the old key, so
  // the row drops back to unresolved and re-reads on the next hover.
  useEffect(() => {
    setCover(getProjectCoverSnapshot(snapshotKey)?.cover);
  }, [snapshotKey]);

  const resolveCover = useCallback(async () => {
    if (getProjectCoverSnapshot(snapshotKey) !== undefined) return;
    // An imported-folder project has no artifact of its own to show.
    if (project.metadata?.entryFile) {
      setProjectCoverSnapshot(snapshotKey, null);
      if (activeRef.current) setCover(null);
      return;
    }
    try {
      const files = await fetchProjectFiles(project.id, { workspaceContext });
      const next = selectProjectFileCover(files);
      setProjectCoverSnapshot(snapshotKey, next);
      if (activeRef.current) setCover(next);
    } catch {
      // Leave it unresolved: a failed read is not an authoritative "no cover",
      // and the next hover should be allowed to try again.
    }
  }, [project.id, project.metadata?.entryFile, snapshotKey, workspaceContext]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  function commitRename() {
    const next = draftName.trim();
    setRenaming(false);
    if (!next || next === project.name) return;
    onRename?.(project.id, next);
  }

  const coverSrc = cover
    ? projectCoverUrl(project.id, cover.name, cover.mtime, workspaceContext)
    : null;
  // `html` covers are documents, not pictures: the grid mounts a sandboxed frame
  // for those. A floating rail preview is not worth a second iframe per hover,
  // so only real media paints here and everything else takes the glyph.
  const showsImage = Boolean(coverSrc && (cover?.kind === 'image' || cover?.kind === 'logo'));
  const showsVideo = Boolean(coverSrc && cover?.kind === 'video');

  return (
    <div
      ref={rootRef}
      className="entry-nav-rail__recent-row"
      onPointerEnter={(event) => {
        // Touch has no hover to leave; the panel would stick until the next tap.
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        // An OPEN MENU OUTRANKS A HOVER (per product: 弹窗和 hover 的预览互斥,
        // and the menu is the one the user asked for by clicking). Without this
        // the two fought: the menu is portalled clear of the rail, so the trip
        // to it re-crossed rows, each of which claimed the slot back for its
        // preview and closed the menu out from under the pointer. A menu now
        // ends only when it is dismissed.
        if (popupClaim?.kind === 'menu') return;
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ top: rect.top + rect.height / 2, left: rect.right + POPUP_GAP_PX });
        claimPopup({ rowId: project.id, kind: 'preview' });
        void resolveCover();
      }}
      onPointerLeave={() => {
        setAnchor(null);
        releasePopup(project.id, 'preview');
      }}
    >
      {renaming ? (
        <input
          ref={renameInputRef}
          className="entry-nav-rail__recent-rename"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraftName(project.name);
              setRenaming(false);
            }
          }}
          aria-label={t('designs.menuRename')}
        />
      ) : (
        <RailRecentItem
          name={project.name}
          selected={selected}
          opening={opening}
          expanded={expanded}
          runStatus={runStatus}
          showLeadingIcon={showLeadingIcon}
          onOpen={() => {
            if (!onOpen || opening) return;
            setOpening(true);
            void Promise.resolve().then(() => onOpen(project.id)).finally(() => {
              if (activeRef.current) setOpening(false);
            });
          }}
        />
      )}
      {onRename || onDelete ? (
        <button
          type="button"
          className="entry-nav-rail__recent-more"
          aria-label={t('designs.menuMore')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="entry-nav-recent-more"
          /* Click only (per product: 点击那三个小点之后才展开弹窗). Opening on
             hover put the menu one stray pointer-move away from closing, which
             is what made it impossible to click through to. */
          onClick={(event) => {
            event.stopPropagation();
            const rect = rootRef.current?.getBoundingClientRect();
            if (rect) setMenuAnchor({ top: rect.top + rect.height / 2, left: rect.right + POPUP_GAP_PX });
            if (menuOpen) releasePopup(project.id, 'menu');
            else claimPopup({ rowId: project.id, kind: 'menu' });
          }}
        >
          <MoreDotsMark />
        </button>
      ) : null}
      {menuOpen && menuAnchor ? (
        <RailRecentMenu
          projectId={project.id}
          projectName={project.name}
          workspaceContext={workspaceContext}
          anchor={menuAnchor}
          rowRef={rootRef}
          onClose={() => releasePopup(project.id, 'menu')}
          onRename={onRename ? () => {
            setDraftName(project.name);
            setRenaming(true);
          } : undefined}
          onDuplicate={onDuplicate ? () => onDuplicate(project.id) : undefined}
          onDelete={onDelete ? () => onDelete(project.id) : undefined}
          onOpen={onOpen ? () => onOpen(project.id) : undefined}
        />
      ) : null}
      {/* The preview hangs OUTSIDE the rail, over the content column — and is
          portalled to <body> to get there. Inside the rail it stayed BEHIND the
          content column no matter its z-index: the column is a positioned,
          backdrop-filtered box and the rail's own z-index traps its children in
          a local stacking context (the same reason the community preview modal
          portals out). Rendered only while hovered, so a rail full of rows never
          holds a dozen idle <img> elements alive. */}
      {anchor && ownsPreview && typeof document !== 'undefined' ? createPortal(
        <div
          className="entry-nav-rail__recent-preview"
          style={{ top: anchor.top, left: anchor.left }}
          aria-hidden
        >
          <div className="entry-nav-rail__recent-preview-plate">
            {showsImage ? (
              <img src={coverSrc ?? ''} alt="" draggable={false} decoding="async" />
            ) : showsVideo ? (
              <video src={coverSrc ?? ''} muted playsInline preload="metadata" />
            ) : (
              <span className="entry-nav-rail__recent-preview-glyph" aria-hidden>
                {(Array.from(project.name.trim())[0] ?? '?').toUpperCase()}
              </span>
            )}
          </div>
          {/* The name the row had to ellipsize, given room to wrap — that is
              the whole job of this card. The "last touched" line that used to
              sit under it is gone (per product: 时间去掉，最多两行名称): a hover
              preview answers "which project is this", and the timestamp was
              answering a question nobody had asked it. */}
          <p className="entry-nav-rail__recent-preview-name">{project.name}</p>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
