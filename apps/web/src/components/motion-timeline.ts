export interface MotionTimelineComment {
  id: string;
  time: number;
  number: number;
  note: string;
}

export const MOTION_DOCK_HEIGHT = 204;

export function motionCompositionSize(source: string) {
  const root = new DOMParser().parseFromString(source, 'text/html').querySelector('[data-composition-id][data-duration][data-width][data-height]');
  if (!root) return null;
  const width = Number(root.getAttribute('data-width')), height = Number(root.getAttribute('data-height'));
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null;
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
