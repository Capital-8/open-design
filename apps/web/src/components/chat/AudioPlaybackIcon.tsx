import type { ReactElement } from 'react';

/** The disc and glyph share one coordinate system, independent of text baselines. */
export function AudioPlaybackIcon({ playing }: { playing: boolean }): ReactElement {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <circle cx="13" cy="13" r="13" fill="var(--chat-text-strong)" />
      {playing ? (
        <path
          d="M10 9h2v8h-2zM14 9h2v8h-2z"
          fill="none"
          stroke="var(--chat-bg)"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        // Preserve the approved 18px glyph and -1px horizontal offset in the 26px disc.
        <path d="M9 7.75v10.5L17.25 13z" fill="var(--chat-bg)" />
      )}
    </svg>
  );
}
