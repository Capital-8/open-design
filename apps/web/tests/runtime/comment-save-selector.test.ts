// @vitest-environment node
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

it.each([
  { name: 'duplicate selector', html: '<h2 id="title">One</h2><h2 id="title">Two</h2>', left: 20, top: 20, width: 100, height: 40, found: false },
  { name: 'duplicate returned annotation', html: '<h2 id="title" data-od-id="shared">One</h2><h2 data-od-id="shared">Two</h2>', left: 20, top: 20, width: 100, height: 40, found: false },
  { name: 'transparent ancestor', html: '<section style="opacity:0"><h2 id="title" style="opacity:1">Title</h2></section>', left: 20, top: 20, width: 100, height: 40, found: false },
  { name: 'hidden ancestor', html: '<section style="visibility:hidden"><h2 id="title" style="visibility:visible">Title</h2></section>', left: 20, top: 20, width: 100, height: 40, found: false },
  { name: 'display-none ancestor', html: '<section style="display:none"><h2 id="title">Title</h2></section>', left: 20, top: 20, width: 100, height: 40, found: false },
  { name: 'outside right edge', html: '<h2 id="title">Title</h2>', left: 1100, top: 20, width: 100, height: 40, found: false },
  { name: 'touching bottom edge', html: '<h2 id="title">Title</h2>', left: 20, top: 768, width: 100, height: 40, found: false },
  { name: 'invalid geometry', html: '<h2 id="title">Title</h2>', left: NaN, top: 20, width: 100, height: 40, found: false },
  { name: 'zero-size geometry', html: '<h2 id="title">Title</h2>', left: 20, top: 20, width: 0, height: 40, found: false },
  { name: 'partially visible target', html: '<section><h2 id="title">Title</h2></section>', left: -20, top: 20, width: 100, height: 40, found: true },
])('strict Motion srcdoc validation: $name', ({ name, html, left, top, width, height, found }) => {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const win = dom.window;
    const replies: Record<string, unknown>[] = [];
    let scrolled = false;
    Object.defineProperty(win, 'parent', { value: { postMessage: (data: Record<string, unknown>) => replies.push(data) } });
    Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', { value: () => new win.DOMRect(left, top, width, height) });
    Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', { value: () => { scrolled = true; } });
    const script = buildSrcdoc('<body></body>', { commentBridge: true, transportActivationGeneration: 'motion-document' })
      .match(/<script data-od-selection-bridge>([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('missing bridge');
    new win.Function(script).call(win);
    // This path must work before entering comment mode; the structure picker is outside the iframe.
    win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-active-target', validateForSave: true,
      strictMotion: true, requestId: 'strict-motion', elementId: 'title', selector: '#title' } }));
    expect(replies.at(-1)).toMatchObject({ type: found ? 'od:comment-active-target-update' : 'od:comment-location-missing',
      documentVersion: 'srcdoc:motion-document', requestId: 'strict-motion' });
    if (found) expect(replies.at(-1)).toMatchObject({ text: 'Title', position: { x: left, y: top, width, height } });
    expect(scrolled).toBe(false);
    if (['duplicate selector', 'duplicate returned annotation', 'transparent ancestor', 'hidden ancestor', 'display-none ancestor', 'outside right edge', 'touching bottom edge'].includes(name)) {
      win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-active-target', validateForSave: true,
        requestId: 'ordinary-comment', elementId: 'title', selector: '#title' } }));
      expect(replies.at(-1)).toMatchObject({ type: 'od:comment-active-target-update', requestId: 'ordinary-comment' });
    }
  } finally { dom.window.close(); }
});

it('save validation follows the current selector across text/replacement changes, and reports deletion', () => {
  const dom = new JSDOM('<body><button>Original</button></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const win = dom.window;
    const replies: Record<string, unknown>[] = [];
    Object.defineProperty(win, 'parent', { value: { postMessage: (data: Record<string, unknown>) => replies.push(data) } });
    Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', { value: () => ({ x: 0, y: 20, width: 100, height: 40 }) });
    const script = buildSrcdoc('<body></body>', { commentBridge: true, inspectBridge: true, transportActivationGeneration: 'document-2' }).match(/<script data-od-selection-bridge>([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('missing bridge');
    new win.Function(script).call(win);
    const save = () => {
      win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-active-target', validateForSave: true,
        requestId: 'save', elementId: 'old-id', selector: 'body > button:nth-of-type(1)' } }));
      return replies.at(-1);
    };
    expect(save()).toMatchObject({ type: 'od:comment-active-target-update', documentVersion: 'srcdoc:document-2', text: 'Original' });
    win.document.querySelector('button')!.textContent = 'Changed copy';
    expect(save()).toMatchObject({ type: 'od:comment-active-target-update', text: 'Changed copy' });
    win.document.querySelector('button')!.outerHTML = '<button data-od-id="new">Replacement</button>';
    expect(save()).toMatchObject({ type: 'od:comment-active-target-update', elementId: 'new', text: 'Replacement', selector: '[data-od-id="new"]', requestedSelector: 'body > button:nth-of-type(1)' });
    win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-mode', enabled: true, mode: 'picker' } }));
    const uuid = '12345678-1234-4234-8234-123456789abc';
    win.document.querySelector('button')!.outerHTML = `<button data-od-comment-id="${uuid}">UUID replacement</button>`;
    expect(save()).toMatchObject({ elementId: `cmt:${uuid}`, selector: `[data-od-comment-id="${uuid}"]`,
      requestedSelector: 'body > button:nth-of-type(1)' });
    win.document.querySelector('button')!.remove();
    expect(save()).toMatchObject({ type: 'od:comment-location-missing', requestId: 'save' });
  } finally { dom.window.close(); }
});

it.each(['span', 'div'])('save accepts an existing %s after picker eligibility changes', tag => {
  const dom = new JSDOM(`<body><${tag}>Original</${tag}></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    const win = dom.window;
    const replies: Record<string, unknown>[] = [];
    Object.defineProperty(win, 'parent', { value: { postMessage: (data: Record<string, unknown>) => replies.push(data) } });
    Object.defineProperty(win.HTMLElement.prototype, 'getBoundingClientRect', { value: () => ({ x: 0, y: 20, width: 100, height: 40 }) });
    const script = buildSrcdoc('<body></body>', { commentBridge: true }).match(/<script data-od-selection-bridge>([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('missing bridge');
    new win.Function(script).call(win);
    const save = () => {
      win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:comment-active-target', validateForSave: true,
        requestId: 'save', elementId: 'old', selector: `body > ${tag}:nth-of-type(1)` } }));
      return replies.at(-1);
    };
    expect(save()).toMatchObject({ type: 'od:comment-active-target-update', text: 'Original' });
    win.document.querySelector(tag)!.innerHTML = tag === 'span' ? '' : '<span>A</span><span>B</span>';
    expect(save()).toMatchObject({ type: 'od:comment-active-target-update', text: tag === 'span' ? '' : 'AB' });
  } finally { dom.window.close(); }
});
