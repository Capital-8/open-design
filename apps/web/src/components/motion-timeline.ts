import type { MotionStructureItem, MotionStructureResponse } from '@open-design/contracts';

export interface MotionTimelineComment {
  id: string;
  time: number;
  number: number;
  note: string;
}

export const MOTION_DOCK_HEIGHT = 144;

/** Overlapping sounds stay individually reachable without growing the whole dock. */
export function motionMediaLanes(items: readonly MotionStructureItem[]) {
  const ends: number[] = [];
  return [...items].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).map(item => {
    const start = item.start ?? 0;
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = start + (item.duration ?? 0);
    return { item, lane };
  });
}
export function motionMediaTrackHeight(items: readonly MotionStructureItem[]) {
  return items.length ? Math.min(2, Math.max(...motionMediaLanes(items).map(item => item.lane + 1))) * 26 + 4 : 0;
}
export function motionDockHeight(_structure?: MotionStructureResponse | null) {
  // Structure navigation is shown on demand; it does not allocate permanent tracks.
  return MOTION_DOCK_HEIGHT;
}

export function motionCompositionSize(source: string) {
  const root = new DOMParser().parseFromString(source, 'text/html').querySelector('[data-composition-id][data-duration][data-width][data-height]');
  if (!root) return null;
  const width = Number(root.getAttribute('data-width')), height = Number(root.getAttribute('data-height'));
  const duration = Number(root.getAttribute('data-duration'));
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    && Number.isFinite(duration) && duration > 0 && root.getAttribute('data-composition-id')?.trim()
    ? { width, height } : null;
}

/** One host transform fits the authored output viewport into the remaining canvas. */
export function motionStageLayout(composition: { width: number; height: number }, available: { width: number; height: number }, requestedScale?: number) {
  const scale = requestedScale ?? Math.min(Math.max(1, available.width) / composition.width, Math.max(1, available.height) / composition.height);
  return { ...composition, scale, left: Math.max(0, (available.width - composition.width * scale) / 2), top: Math.max(0, (available.height - composition.height * scale) / 2) };
}

/** Keep neighboring feedback reachable at every dock width. */
export function groupMotionTimelineComments(comments: readonly MotionTimelineComment[], duration: number, width: number) {
  if (!(duration > 0)) return [];
  const groups: { time: number; comments: MotionTimelineComment[] }[] = [];
  for (const comment of [...comments].filter(comment => Number.isFinite(comment.time) && comment.time >= 0 && comment.time <= duration).sort((a, b) => a.time - b.time)) {
    const previous = groups.at(-1);
    if (previous && (comment.time - previous.time) / duration * Math.max(1, width) < 26) previous.comments.push(comment);
    else groups.push({ time: comment.time, comments: [comment] });
  }
  return groups;
}

export function motionTimelineTicks(duration: number, width: number): number[] {
  if (!(duration > 0) || !Number.isFinite(duration)) return [];
  const raw = duration / Math.max(2, Math.floor(width / 82));
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= raw) ?? raw;
  const ticks = [0];
  for (let time = step; time < duration - step * .45; time += step) ticks.push(Number(time.toPrecision(12)));
  ticks.push(duration);
  return ticks;
}
