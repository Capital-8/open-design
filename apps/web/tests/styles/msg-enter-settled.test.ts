// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readExpandedIndexCss } from '../helpers/read-expanded-css';

/*
 * OPEND-3922 · a `.msg` row marked `data-enter="skip"` must not replay
 * `msg-enter`. Creating a project from Home hands the first turn across three
 * surfaces (pending frame → ProjectView's hand-off card → real ChatPane); each
 * re-mount used to fade the same rows in from transparent again, so the chat
 * column visibly flashed twice.
 *
 * Same technique as `msg-enter-animation-flag.test.ts`: feed the whole expanded
 * `index.css` (product @import order) and read the cascaded `animation`, so a
 * later sheet writing the animation back onto `.msg` would turn this red.
 */

let styleEl: HTMLStyleElement;

beforeAll(() => {
  styleEl = document.createElement('style');
  styleEl.textContent = readExpandedIndexCss();
  document.head.appendChild(styleEl);
});

afterEach(() => {
  document.body.innerHTML = '';
});

function renderMessage(role: 'user' | 'assistant', enter?: string): HTMLElement {
  const attr = enter === undefined ? '' : ` data-enter="${enter}"`;
  document.body.innerHTML =
    `<div class="app"><div class="chat-log"><div class="msg ${role}" id="msg"${attr}>hi</div></div></div>`;
  const el = document.getElementById('msg');
  if (!el) throw new Error('fixture did not render');
  return el;
}

describe('settled transcript rows skip msg-enter (OPEND-3922)', () => {
  it('a row marked data-enter="skip" has no entrance animation', () => {
    for (const role of ['user', 'assistant'] as const) {
      expect(getComputedStyle(renderMessage(role, 'skip')).animation.trim()).toBe('none');
    }
  });

  it('an unmarked row still plays msg-enter (new messages keep their entrance)', () => {
    for (const role of ['user', 'assistant'] as const) {
      expect(getComputedStyle(renderMessage(role)).animation).toContain('msg-enter');
    }
  });

  it('only the exact "skip" value opts out', () => {
    expect(getComputedStyle(renderMessage('assistant', '')).animation).toContain('msg-enter');
  });
});
