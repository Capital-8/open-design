import type { PreviewCommentMotionAnchor } from '@open-design/contracts';
import type { PreviewCommentSnapshot } from './anchor';

export interface MotionCaptureContext {
  documentToken: string | null;
  motion: PreviewCommentMotionAnchor;
  playing: boolean;
  locked: boolean;
}

export interface MotionFrameSnapshot {
  dataUrl: string;
  w: number;
  h: number;
}

/** A screenshot is evidence only while its document and paused clock agree. */
export async function captureMotionCommentFrame(
  context: () => MotionCaptureContext | null,
  capture: () => Promise<MotionFrameSnapshot | null>,
): Promise<{ snapshot: MotionFrameSnapshot; motion: PreviewCommentMotionAnchor }> {
  const before = context();
  if (!before?.documentToken || before.playing || !before.locked) throw new Error('MOTION_NOT_PAUSED');
  const snapshot = await capture();
  const after = context();
  if (!after || before.documentToken !== after.documentToken || after.playing || !after.locked
    || before.motion.sourceFingerprint !== after.motion.sourceFingerprint
    || Math.abs(before.motion.timeSeconds - after.motion.timeSeconds) > 0.00001) {
    throw new Error('MOTION_PREVIEW_CHANGED');
  }
  if (!snapshot?.dataUrl.startsWith('data:image/') || !(snapshot.w > 0 && snapshot.h > 0)) {
    throw new Error('MOTION_CAPTURE_FAILED');
  }
  return { snapshot, motion: before.motion };
}

export function motionCommentVisible(
  motion: PreviewCommentMotionAnchor | undefined,
  current: { time: number; playing: boolean; sourceFingerprint: string } | null,
): boolean {
  if (!motion) return true;
  if (!current || current.playing || motion.sourceFingerprint !== current.sourceFingerprint) return false;
  // A reference identifies one output sample; unknown rates use a narrow time window.
  return Math.abs(motion.timeSeconds - current.time) < (motion.fps ? 0.5 / motion.fps : 0.05);
}

/** Reposition the on-screen mark after a resize, preserving the saved evidence. */
export function motionCommentDisplaySnapshot<T extends PreviewCommentSnapshot>(
  snapshot: T,
  targets: ReadonlyMap<string, PreviewCommentSnapshot>,
  current: Parameters<typeof motionCommentVisible>[1],
): T {
  if (!snapshot.motion || !motionCommentVisible(snapshot.motion, current)) return snapshot;
  const target = targets.get(snapshot.elementId);
  if (!target || target.filePath !== snapshot.filePath || target.selector !== snapshot.selector) return snapshot;
  return { ...snapshot, position: target.position };
}
