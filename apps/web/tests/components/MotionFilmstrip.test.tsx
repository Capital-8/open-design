// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MOTION_PREVIEW_COMMAND, MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_STATE } from '@open-design/contracts/runtime/motion-source-player';
import { MotionFilmstrip } from '../../src/components/MotionFilmstrip';
import { buildMotionFilmstripDocument, motionFilmstripTimes, MOTION_FILMSTRIP_LIMIT } from '../../src/runtime/motion-filmstrip';

afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });
const source = { document: '<html><body>frame</body></html>', identity: 'source-a', size: { width: 1920, height: 1080 } };
const state = { active: false, playing: false, time: 0, duration: 12, muted: true, locked: false, fps: 30 };
function message(frame: HTMLIFrameElement, data: object) {
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { ...data, type: MOTION_PREVIEW_STATE } }));
}

it('bounds thumbnail documents and samples valid times from the opening through the ending', () => {
  const small = motionFilmstripTimes(12, 250);
  expect(small).toEqual([2, 6, 10]);
  const wide = motionFilmstripTimes(12, 5000);
  expect(wide).toHaveLength(MOTION_FILMSTRIP_LIMIT);
  expect(wide.every(time => time > 0 && time < 12)).toBe(true);
  expect(motionFilmstripTimes(0, 500)).toEqual([]);
  render(<MotionFilmstrip source={source} duration={12} width={5000} />);
  expect(screen.getAllByTestId('motion-filmstrip-frame')).toHaveLength(MOTION_FILMSTRIP_LIMIT);
});

it('shows a frame only after its own seek and lock acknowledgements without commanding the main preview', async () => {
  const main = document.createElement('iframe'); document.body.append(main);
  const mainPost = vi.spyOn(main.contentWindow!, 'postMessage');
  const { rerender } = render(<MotionFilmstrip source={source} duration={12} width={250} />);
  const frames = screen.getAllByTestId('motion-filmstrip-frame') as HTMLIFrameElement[];
  // Let jsdom finish its initial iframe navigation before driving our handshake.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  vi.useFakeTimers();
  const frame = frames[0]!;
  const outgoing = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  fireEvent.load(frame);
  const hello = outgoing.mock.calls.map(([data]) => data).filter(data => data.type === MOTION_PREVIEW_CONNECT).at(-1)!;
  await act(async () => { message(frame, { ...hello, instance: 'doc-a', state }); });
  const seek = outgoing.mock.calls.map(([data]) => data).find(data => data.type === MOTION_PREVIEW_COMMAND)!;
  expect(seek.control).toEqual({ action: 'seek', time: 2 });
  await act(async () => { message(frames[1]!, { ...seek, instance: 'doc-a', state: { ...state, time: 2 } }); });
  expect(outgoing.mock.calls.filter(([data]) => data.control?.action === 'lock')).toHaveLength(0);
  expect(frame.parentElement).toHaveAttribute('data-state', 'loading');
  await act(async () => { message(frame, { ...seek, instance: 'doc-a', state: { ...state, time: 2 } }); });
  const lock = outgoing.mock.calls.map(([data]) => data).find(data => data.control?.action === 'lock')!;
  expect(lock.control).toEqual({ action: 'lock', value: true });
  await act(async () => { message(frame, { ...lock, instance: 'doc-a', state: { ...state, time: 2, locked: true } }); });
  expect(frame.parentElement).toHaveAttribute('data-state', 'ready');
  // A load can replace the document after the first binding. Hide the old
  // paint and repeat the handshake for the new document rather than staying blank.
  fireEvent.load(frame);
  expect(frame.parentElement).toHaveAttribute('data-state', 'loading');
  const nextHello = outgoing.mock.calls.map(([data]) => data).filter(data => data.type === MOTION_PREVIEW_CONNECT).at(-1)!;
  await act(async () => { message(frame, { ...nextHello, instance: 'doc-b', state }); });
  const nextSeek = outgoing.mock.calls.map(([data]) => data).filter(data => data.control?.action === 'seek').at(-1)!;
  await act(async () => { message(frame, { ...nextSeek, instance: 'doc-b', state: { ...state, time: 2 } }); });
  const nextLock = outgoing.mock.calls.map(([data]) => data).filter(data => data.control?.action === 'lock').at(-1)!;
  await act(async () => { message(frame, { ...nextLock, instance: 'doc-b', state: { ...state, time: 2, locked: true } }); });
  expect(frame.parentElement).toHaveAttribute('data-state', 'ready');
  expect(mainPost).not.toHaveBeenCalled();
  rerender(<MotionFilmstrip source={{ ...source, identity: 'source-b', document: '<html>changed</html>' }} duration={12} width={250} />);
  expect(frame.isConnected).toBe(false);
  expect(screen.getAllByTestId('motion-filmstrip-frame').every(item => item.parentElement?.dataset.state === 'loading')).toBe(true);
  main.remove();
});

it('sets mute protection before author scripts while retaining guarded relative-asset loading', () => {
  const html = '<!doctype html><html><head><meta name="od-motion-output" content="video"><script>window.authorStartsHere=true;</script></head><body><main data-composition-id="main" data-duration="12" data-width="1920" data-height="1080"></main></body></html>';
  const built = buildMotionFilmstripDocument(html, 'http://localhost/api/projects/p/raw/', 3);
  expect(built.indexOf('window.__odMotionThumbnail = true')).toBeLessThan(built.indexOf('window.authorStartsHere'));
  expect(built).toContain('event.target.muted = true; event.target.pause()');
  const parsed = new DOMParser().parseFromString(built, 'text/html');
  expect(parsed.querySelector('base')?.href).toBe('http://localhost/api/projects/p/raw/');
  expect(parsed.querySelector('[data-od-motion-source-player]')).not.toBeNull();
});

it('re-runs authored fit handlers when a parked thumbnail receives its real viewport', () => {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const child = frame.contentWindow as Window & typeof globalThis;
  const viewport = child.document.createElement('div'); child.document.body.append(viewport);
  Object.defineProperty(child, 'innerWidth', { configurable: true, value: 0 });
  const fit = () => { viewport.style.transform = `scale(${child.innerWidth / 1920})`; };
  fit(); child.addEventListener('resize', fit);
  let paint!: () => void;
  vi.spyOn(child, 'requestAnimationFrame').mockImplementation(callback => { paint = () => callback(0); return 1; });
  const html = buildMotionFilmstripDocument('<html><body></body></html>', 'http://localhost/', 0);
  const bootstrap = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-od-motion-filmstrip]')!.textContent!;
  new Function('window', 'document', 'HTMLMediaElement', 'Event', bootstrap)(child, child.document, child.HTMLMediaElement, child.Event);
  child.dispatchEvent(new child.MessageEvent('message', { source: child, data: { type: MOTION_PREVIEW_COMMAND, control: { action: 'seek', time: 1 } } }));
  expect(paint).toBeUndefined();
  child.dispatchEvent(new child.MessageEvent('message', { source: child.parent, data: { type: MOTION_PREVIEW_COMMAND, control: { action: 'seek', time: 1 } } }));
  expect(viewport.style.transform).toBe('scale(0)');
  Object.defineProperty(child, 'innerWidth', { configurable: true, value: 1920 });
  paint();
  expect(viewport.style.transform).toBe('scale(1)');
});
