import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PreviewComment } from '../types';
import { Icon } from './Icon';
import styles from './CommentBrowse.module.css';

export function useCommentHoverPreview(suppressed: boolean) {
  const [preview, setPreview] = useState<{ comment: PreviewComment; anchor: DOMRect; preferLeft: boolean } | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = () => { clearTimeout(timer.current); clearTimeout(fadeTimer.current); setClosing(false); };
  const dismiss = () => { clearTimeout(timer.current); clearTimeout(fadeTimer.current); setPreview(null); setClosing(false); };
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(fadeTimer.current); }, []);
  return {
    preview: suppressed ? null : preview,
    closing,
    show: (comment: PreviewComment, node: HTMLElement, preferLeft = false) => {
      keep();
      if (!suppressed) setPreview({ comment, anchor: node.getBoundingClientRect(), preferLeft });
    },
    keep,
    dismiss,
    leave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setClosing(true);
        fadeTimer.current = setTimeout(() => setPreview(null), 100);
      }, 200);
    },
  };
}

export function CommentHoverPreview({ state, author, bounds, images = [], imageFailedLabel = 'Image unavailable' }: {
  state: ReturnType<typeof useCommentHoverPreview>;
  author: ReactNode;
  bounds?: DOMRect;
  images?: { url: string; name: string }[];
  imageFailedLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 280, height: 120 });
  const preview = state.preview;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, [preview]);
  if (!preview) return null;
  const { anchor, comment, preferLeft } = preview;
  const minX = (bounds?.left ?? 0) + 16;
  const maxX = (bounds?.right ?? window.innerWidth) - 16;
  const minY = (bounds?.top ?? 0) + 16;
  const maxY = (bounds?.bottom ?? window.innerHeight) - 16;
  const rightFits = anchor.right + 12 + size.width <= maxX;
  const leftFits = anchor.left - 12 - size.width >= minX;
  let left: number;
  let top: number;
  if ((preferLeft && leftFits) || (!rightFits && leftFits)) {
    left = anchor.left - 12 - size.width;
    top = Math.max(minY, Math.min(anchor.top, maxY - size.height));
  } else if (rightFits) {
    left = anchor.right + 12;
    top = Math.max(minY, Math.min(anchor.top, maxY - size.height));
  } else if (anchor.top - 12 - size.height >= minY) {
    left = Math.max(minX, Math.min(anchor.left, maxX - size.width));
    top = anchor.top - 12 - size.height;
  } else if (anchor.bottom + 12 + size.height <= maxY) {
    left = Math.max(minX, Math.min(anchor.left, maxX - size.width));
    top = anchor.bottom + 12;
  } else return null;
  return createPortal(<div ref={ref} className={`${styles.preview}${state.closing ? ` ${styles.closing}` : ''}`} role="tooltip"
    style={{ left, top, maxHeight: Math.max(80, maxY - minY) }}
    onMouseEnter={state.keep} onMouseLeave={state.leave}>
    {author}{comment.note ? <p>{comment.note}</p> : null}
    {images.length > 0 ? <div className={styles.previewImages}>{images.map(image => <a key={image.url} href={image.url} target="_blank" rel="noopener noreferrer" title={image.name}><CommentImage src={image.url} name={image.name} failedLabel={imageFailedLabel} /></a>)}</div> : null}
  </div>, document.body);
}

export function CommentAvatarRail({ comments, activeId, unreadIds, renderAvatar, label, moreLabel, onOpen, onExpand, toggleRef, hover, expandLabel = 'Show comments' }: {
  comments: PreviewComment[];
  activeId: string | null;
  unreadIds: ReadonlySet<string>;
  renderAvatar: (comment: PreviewComment) => ReactNode;
  label: (comment: PreviewComment) => string;
  moreLabel: (count: number) => string;
  onOpen: (comment: PreviewComment) => void;
  onExpand: () => void;
  expandLabel?: string;
  toggleRef: React.RefObject<HTMLButtonElement>;
  hover: ReturnType<typeof useCommentHoverPreview>;
}) {
  const hidden = Math.max(0, comments.length - 5);
  return <aside className={`${styles.rail} comment-side-rail`} data-testid="comment-side-collapsed-rail">
    <button ref={toggleRef} className={styles.toggle} type="button" onClick={onExpand} aria-expanded={false} aria-label={expandLabel} title={expandLabel}>
      <Icon name="chevron-left" size={14} /><Icon name="chevron-left" size={14} />
    </button>
    <div className={styles.avatars}>
      {comments.slice(0, 5).map(comment => <button key={comment.id} type="button"
        className={`${styles.avatar}${activeId === comment.id ? ` ${styles.active}` : ''}`}
        aria-label={label(comment)} aria-current={activeId === comment.id ? 'true' : undefined}
        onMouseEnter={event => hover.show(comment, event.currentTarget, true)} onMouseLeave={hover.leave}
        onFocus={event => hover.show(comment, event.currentTarget, true)} onBlur={hover.leave}
        onClick={() => { hover.dismiss(); onOpen(comment); }}>
        {renderAvatar(comment)}{unreadIds.has(comment.id) ? <i className={styles.unread} /> : null}
      </button>)}
      {hidden > 0 ? <span className={styles.more} aria-label={moreLabel(hidden)} title={moreLabel(hidden)}>+{Math.min(99, hidden)}
        {comments.slice(5).some(comment => unreadIds.has(comment.id)) ? <i className={styles.unread} /> : null}
      </span> : null}
    </div>
  </aside>;
}

export function CommentImage({ src, name, failedLabel }: { src: string; name: string; failedLabel: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className={styles.imageFailed} role="img" aria-label={`${name}: ${failedLabel}`}>{failedLabel}</span>
    : <img src={src} alt={name} onError={() => setFailed(true)} />;
}
