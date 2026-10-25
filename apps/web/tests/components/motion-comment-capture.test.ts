import { describe, expect, it } from 'vitest';
import { captureMotionCommentFrame, motionCommentVisible, motionCommentDisplaySnapshot, type MotionCaptureContext } from '../../src/comments/motion-capture';

const motion = { timeSeconds: 2.4, durationSeconds: 8, fps: 30, sourceFingerprint: 'original' };
const context = (): MotionCaptureContext => ({ documentToken: 'doc:1', motion, playing: false, locked: true });
const shot = { dataUrl: 'data:image/png;base64,cGl4ZWxz', w: 1280, h: 720 };

describe('Motion frame evidence', () => {
  it('binds a captured image to the confirmed paused time', async () => {
    expect(await captureMotionCommentFrame(context, async () => shot)).toEqual({ snapshot: shot, motion });
  });
  it('rejects missing screenshots so the caller can retain the draft', async () => {
    await expect(captureMotionCommentFrame(context, async () => null)).rejects.toThrow('MOTION_CAPTURE_FAILED');
  });
  it('rejects a screenshot that completes after navigation starts', async () => {
    let current: MotionCaptureContext | null = context();
    await expect(captureMotionCommentFrame(() => current, async () => {
      current = null;
      return shot;
    })).rejects.toThrow('MOTION_PREVIEW_CHANGED');
  });
  it('rejects clock drift and a running timeline', async () => {
    let current = context();
    await expect(captureMotionCommentFrame(() => current, async () => {
      current = { ...current, motion: { ...motion, timeSeconds: 3 } };
      return shot;
    })).rejects.toThrow('MOTION_PREVIEW_CHANGED');
    await expect(captureMotionCommentFrame(() => ({ ...context(), playing: true }), async () => shot))
      .rejects.toThrow('MOTION_NOT_PAUSED');
  });
  it('shows temporal marks only at their paused reference in the same source', () => {
    expect(motionCommentVisible(motion, { time: 2.4, playing: false, sourceFingerprint: 'original' })).toBe(true);
    expect(motionCommentVisible(motion, { time: 2.4, playing: true, sourceFingerprint: 'original' })).toBe(false);
    expect(motionCommentVisible(motion, { time: 3, playing: false, sourceFingerprint: 'original' })).toBe(false);
    expect(motionCommentVisible(motion, { time: 2.4, playing: false, sourceFingerprint: 'updated' })).toBe(false);
    expect(motionCommentVisible(undefined, null)).toBe(true);
  });
  it('repositions the visible mark after resizing without changing the original evidence', () => {
    const saved = { filePath: 'film.html', elementId: 'title', selector: '#title', label: 'Title', text: 'Title', htmlHint: '',
      position: { x: 48, y: 195, width: 93, height: 38 }, motion };
    const resized = { ...saved, position: { x: 180, y: 120, width: 300, height: 110 } };
    const targets = new Map([[saved.elementId, resized]]);
    const current = { time: 2.4, playing: false, sourceFingerprint: 'original' };
    const displayed = motionCommentDisplaySnapshot(saved, targets, current);
    expect(displayed.position).toEqual(resized.position);
    expect(saved.position).toEqual({ x: 48, y: 195, width: 93, height: 38 });
    expect(displayed.motion).toBe(saved.motion);
    expect(motionCommentDisplaySnapshot(saved, targets, { ...current, sourceFingerprint: 'changed' })).toBe(saved);
    expect(motionCommentDisplaySnapshot(saved, targets, { ...current, time: 5 })).toBe(saved);
  });
});
