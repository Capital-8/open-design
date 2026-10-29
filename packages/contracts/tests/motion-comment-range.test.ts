import { describe, expect, it } from 'vitest';
import { parsePreviewCommentMotionAnchor } from '../src/api/comments.js';

const anchor = { timeSeconds: 6.5, durationSeconds: 12, fps: 30, sourceFingerprint: 'source' };

describe('Motion feedback ranges', () => {
  it('preserves legacy anchors and distinguishes the reference frame from an interval', () => {
    expect(parsePreviewCommentMotionAnchor(anchor)).toEqual(anchor);
    const ranged = { ...anchor, range: { startSeconds: 5, endSeconds: 8 } };
    expect(parsePreviewCommentMotionAnchor(ranged)).toEqual(ranged);
    // A selected interval is context; the reference frame may be outside it.
    expect(parsePreviewCommentMotionAnchor({ ...ranged, timeSeconds: 2 })).toMatchObject({ timeSeconds: 2, range: ranged.range });
    expect(parsePreviewCommentMotionAnchor({ ...anchor, range: { startSeconds: 0, endSeconds: 12 } })).not.toBeNull();
  });

  it.each([null, [], {}, { startSeconds: 5 }, { startSeconds: '5', endSeconds: 8 },
    { startSeconds: -1, endSeconds: 8 }, { startSeconds: 8, endSeconds: 8 },
    { startSeconds: 9, endSeconds: 8 }, { startSeconds: 0, endSeconds: 13 },
    { startSeconds: NaN, endSeconds: 8 }, { startSeconds: 0, endSeconds: Infinity },
  ])('rejects malformed or out-of-bounds range %j', (range) => {
    expect(parsePreviewCommentMotionAnchor({ ...anchor, range })).toBeNull();
  });
});
