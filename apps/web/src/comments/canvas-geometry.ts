import { overlayBoundsFromSnapshot, preserveCommentPoint, type PreviewCommentSnapshot } from './anchor';

/** Coordinates are CSS pixels in the existing comment overlay, after preview scaling.
 * The caller converts the actual visible canvas rectangle into that same space.
 * Do not pass the surrounding preview body: it also contains the comment dock. */
export interface CommentCanvasRect { left: number; top: number; width: number; height: number }
export interface CommentCanvasPoint { x: number; y: number }
export interface CommentCanvasTransform { scale: number; offset?: CommentCanvasPoint }
export const COMMENT_MARKER_SIZE = 28;
export const COMMENT_MARKER_STEP = 22;
export const COMMENT_MARKER_INSET = 16;

export function projectCommentPoint(target: PreviewCommentSnapshot, transform: CommentCanvasTransform): CommentCanvasPoint {
  const point = preserveCommentPoint(target, target).hoverPoint ?? { x: target.position.x, y: target.position.y };
  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
  return { x: (transform.offset?.x ?? 0) + point.x * scale, y: (transform.offset?.y ?? 0) + point.y * scale };
}

export function commentPointInCanvas(point: CommentCanvasPoint, canvas: CommentCanvasRect): boolean {
  return canvas.width > 0 && canvas.height > 0 && point.x >= canvas.left && point.x <= canvas.left + canvas.width
    && point.y >= canvas.top && point.y <= canvas.top + canvas.height;
}

export function clippedCommentTarget(target: PreviewCommentSnapshot, transform: CommentCanvasTransform, canvas: CommentCanvasRect): CommentCanvasRect | null {
  const rect = overlayBoundsFromSnapshot(target, transform.scale, transform.offset);
  const left = Math.max(canvas.left, rect.left), top = Math.max(canvas.top, rect.top);
  const right = Math.min(canvas.left + canvas.width, rect.left + rect.width);
  const bottom = Math.min(canvas.top + canvas.height, rect.top + rect.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** The first avatar extends right/up from its true point. Only display rectangles
 * move inward; source snapshots and fractional element anchors are never changed. */
export function layoutCommentMarkerCluster(point: CommentCanvasPoint, count: number, canvas: CommentCanvasRect) {
  if (!commentPointInCanvas(point, canvas)) return null;
  const availableWidth = canvas.width - 2 * COMMENT_MARKER_INSET;
  if (availableWidth < COMMENT_MARKER_SIZE || canvas.height < COMMENT_MARKER_SIZE + 2 * COMMENT_MARKER_INSET) return null;
  const visibleCount = Math.min(count, 5, 1 + Math.floor((availableWidth - COMMENT_MARKER_SIZE) / COMMENT_MARKER_STEP));
  if (visibleCount <= 0) return null;
  const width = COMMENT_MARKER_SIZE + (visibleCount - 1) * COMMENT_MARKER_STEP;
  const left = Math.max(canvas.left + COMMENT_MARKER_INSET, Math.min(point.x, canvas.left + canvas.width - COMMENT_MARKER_INSET - width));
  const top = Math.max(canvas.top + COMMENT_MARKER_INSET, Math.min(point.y - COMMENT_MARKER_SIZE, canvas.top + canvas.height - COMMENT_MARKER_INSET - COMMENT_MARKER_SIZE));
  return { left, top, width, height: COMMENT_MARKER_SIZE, visibleCount, point,
    avatars: Array.from({ length: visibleCount }, (_, index) => ({ left: left + index * COMMENT_MARKER_STEP, top, width: COMMENT_MARKER_SIZE, height: COMMENT_MARKER_SIZE })) };
}

export interface CommentMarkerInput { id: string; target: PreviewCommentSnapshot; anchorState?: string }
/** Creation-ordered comments keep the first comment as the cluster origin.
 * Filtering lost anchors here affects rendering only, never durable resolution. */
export function groupCommentMarkers<T extends CommentMarkerInput>(items: readonly T[], transform: CommentCanvasTransform, canvas: CommentCanvasRect) {
  const groups: { point: CommentCanvasPoint; members: T[] }[] = [];
  for (const item of items) {
    if (item.anchorState === 'lost') continue;
    const point = projectCommentPoint(item.target, transform);
    if (!commentPointInCanvas(point, canvas)) continue;
    const existing = groups.find(group => group.members[0]?.target.elementId === item.target.elementId && Math.hypot(group.point.x - point.x, group.point.y - point.y) < 0.01);
    if (existing) existing.members.push(item); else groups.push({ point, members: [item] });
  }
  return groups.flatMap(group => {
    const layout = layoutCommentMarkerCluster(group.point, group.members.length, canvas);
    return layout ? [{ ...group, layout, visibleMembers: group.members.slice(0, layout.visibleCount) }] : [];
  });
}

export function commentTargetLabelLayout(rect: CommentCanvasRect, canvas: CommentCanvasRect) {
  const below = rect.top < canvas.top + 25;
  const rightAligned = rect.left + rect.width / 2 > canvas.left + canvas.width / 2;
  const edge = rightAligned ? Math.min(rect.left + rect.width, canvas.left + canvas.width - 8) : Math.max(rect.left, canvas.left + 8);
  return { left: edge, top: below ? Math.min(rect.top + rect.height + 4, canvas.top + canvas.height - 22) : rect.top - 4,
    maxWidth: Math.max(0, rightAligned ? edge - canvas.left - 8 : canvas.left + canvas.width - edge - 8),
    transform: `translate(${rightAligned ? '-100%' : '0'}, ${below ? '0' : '-100%'})` };
}
