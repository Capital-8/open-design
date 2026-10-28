// @vitest-environment node
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildSrcdoc } from '../../src/runtime/srcdoc';
import { injectCommentBridge } from '../../src/runtime/comment-bridge';

// Captured wire contract: FNV-1a of authored srcdoc + newline + about:srcdoc.
const anchor = 'od-frame-v1:' + JSON.stringify([[
  ['dom:body > iframe:nth-of-type(1)', 'body > iframe:nth-of-type(1)', 'srcdoc:0:fbc0cc3c'],
], 'dom:body > h2:nth-of-type(1)', 'body > h2:nth-of-type(1)']);

for (const portable of [false, true]) for (const depth of [1, 2]) describe(`nested cloud anchors (portable=${portable}, depth=${depth})`, () => {
  it('locates inside the child, projects scale/borders, preserves the wire anchor and rejects replacements', () => {
    const dom = new JSDOM('<body><iframe srcdoc=""></iframe></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      const win = dom.window, frame = win.document.querySelector('iframe')!;
      const frames = [frame];
      let child = frame.contentDocument!;
      Object.defineProperty(child, 'URL', { value: 'about:srcdoc' });
      if (depth === 2) {
        child.body.innerHTML = '<iframe srcdoc=""></iframe>';
        frames.push(child.querySelector('iframe')!);
        child = frames[1]!.contentDocument!;
        Object.defineProperty(child, 'URL', { value: 'about:srcdoc' });
      }
      const wire = JSON.parse(anchor.slice(12));
      if (depth === 2) wire[0].push(wire[0][0]);
      const nestedAnchor = 'od-frame-v1:' + JSON.stringify(wire);
      child.body.innerHTML = '<h2>Nested comment</h2>';
      const target = child.querySelector('h2')!;
      const postMessage = vi.fn(), scroll = vi.fn(), frameScroll = vi.fn();
      Object.defineProperty(win, 'parent', { value: { postMessage }, configurable: true });
      Object.defineProperty(target, 'scrollIntoView', { value: scroll });
      for (const item of frames) Object.defineProperty(item, 'scrollIntoView', { value: frameScroll });
      Object.defineProperty(target, 'getBoundingClientRect', { value: () => ({ left: 10, top: 20, width: 100, height: 30 }) });
      for (const frame of frames) {
      Object.defineProperty(frame, 'getBoundingClientRect', { value: () => ({ left: 40, top: 60, width: 400, height: 300 }) });
      for (const [key, value] of Object.entries({ offsetWidth: 200, offsetHeight: 150, clientLeft: 2, clientTop: 3 })) Object.defineProperty(frame, key, { value });
      }
      const html = portable ? injectCommentBridge('<body></body>') : buildSrcdoc('<body></body>', { commentBridge: true });
      const script = html.match(/<script data-od-(?:selection|comment)-bridge>([\s\S]*?)<\/script>/)?.[1];
      if (!script) throw new Error('bridge missing');
      new win.Function(script).call(win);
      const locate = (selector = nestedAnchor, elementId = selector) => {
        postMessage.mockClear();
        win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-active-target', elementId, selector, locate: true, requestId: 'nested' } }));
        return postMessage.mock.calls.map(call => call[0]).find(m => m.requestId === 'nested');
      };
      expect(locate()).toMatchObject({ type: 'od:comment-active-target-update', elementId: nestedAnchor, selector: nestedAnchor, position: depth === 1 ? { x: 64, y: 106, width: 200, height: 60 } : { x: 172, y: 278, width: 400, height: 120 } });
      expect(scroll).toHaveBeenCalledOnce(); expect(frameScroll).toHaveBeenCalledTimes(depth);
      expect(locate('od-frame-v1:bad')).toMatchObject({ type: 'od:comment-location-missing' });
      expect(locate(nestedAnchor, 'dom:body')).toMatchObject({ type: 'od:comment-location-missing' });
      Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => null });
      expect(locate()).toMatchObject({ type: 'od:comment-location-missing' });
      Reflect.deleteProperty(frame, 'contentDocument');
      frame.setAttribute('srcdoc', '<h2>Replacement</h2>');
      expect(locate()).toMatchObject({ type: 'od:comment-location-missing' });
      expect(scroll).toHaveBeenCalledOnce();
    } finally { dom.window.close(); }
  });
});
