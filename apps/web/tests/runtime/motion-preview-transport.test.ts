// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_STATE } from '@open-design/contracts/runtime/motion-source-player';
import { MotionPreviewTransport, isMotionPlayerState } from '../../src/runtime/motion-preview-transport';

const state = { playing: true, active: true, time: 2.4, duration: 8, muted: false, locked: false, fps: 30 };
let transport: MotionPreviewTransport | undefined;
afterEach(() => { transport?.dispose(); transport = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(contentIdentity?: string) {
  vi.useFakeTimers();
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  const outgoing = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const changed = vi.fn(); let currentIdentity = 'file-a', currentFrame = frame, currentEnabled = true, currentContentIdentity = contentIdentity;
  transport = new MotionPreviewTransport(changed, (source, identity) => source === currentFrame && identity === currentIdentity,
    () => ({ frame: currentFrame, identity: currentIdentity, contentIdentity: currentContentIdentity, enabled: currentEnabled }));
  transport.bind(frame, 'file-a', true, contentIdentity);
  const send = (message: object, source: MessageEventSource | null = frame.contentWindow) => window.dispatchEvent(new MessageEvent('message', { source, data: { type: MOTION_PREVIEW_STATE, ...message } }));
  const handshake = () => [...outgoing.mock.calls].reverse().find(([data]) => data.type === MOTION_PREVIEW_CONNECT)![0] as {clientId: string; requestId: string};
  const connect = (snapshot = state) => { const hello = handshake(); send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'doc-a', state: snapshot }); return hello; };
  return { frame, outgoing, changed, send, connect, handshake,
    setIdentity: (value: string) => { currentIdentity = value; },
    setFrame: (value: HTMLIFrameElement) => { currentFrame = value; },
    setEnabled: (value: boolean) => { currentEnabled = value; },
    setContentIdentity: (value: string) => { currentContentIdentity = value; },
  };
}

it('resolves a command only after its actual state acknowledgement', async () => {
  const { connect, outgoing, send } = setup(); const hello = connect();
  const result = transport!.command({ action: 'pause' });
  const request = outgoing.mock.calls.at(-1)![0];
  let settled = false; void result.then(() => { settled = true; });
  send({ ...hello, requestId: null, instance: 'doc-a', state: { ...state, time: 2.5, playing: false } });
  await Promise.resolve(); expect(settled).toBe(false);
  send({ clientId: request.clientId, requestId: request.requestId, instance: 'doc-a', state: { ...state, time: 2.5, playing: false } });
  await expect(result).resolves.toMatchObject({ time: 2.5, playing: false });
});

it('ignores foreign windows, obsolete challenges, document instances and request IDs', () => {
  const { connect, send } = setup(); const hello = connect();
  for (const message of [
    { clientId: 'old-client', instance: 'doc-a', requestId: null },
    { clientId: hello.clientId, instance: 'old-doc', requestId: null },
    { clientId: hello.clientId, instance: 'doc-a', requestId: 'unknown-request' },
  ]) send({ ...message, state: { ...state, time: 7 } });
  send({ clientId: hello.clientId, instance: 'doc-a', requestId: null, state: { ...state, time: 7 } }, window);
  expect(transport!.getState()?.time).toBe(2.4);
});

it('invalidates before navigation and rejects a pending capture pause; late replies cannot restore the old document', async () => {
  const { connect, send, frame, handshake } = setup(); const hello = connect();
  const result = transport!.command({ action: 'pause' });
  const rejected = expect(result).rejects.toThrow('motion.previewChanged');
  transport!.invalidate();
  expect(transport!.getDocumentToken()).toBeNull();
  send({ ...hello, requestId: null, instance: 'doc-a', state });
  expect(transport!.getState()).toBeNull();
  await rejected;
  frame.dispatchEvent(new Event('load'));
  const next = handshake(); expect(next.clientId).not.toBe(hello.clientId);
  send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'doc-a', state });
  expect(transport!.getState()).toBeNull();
  send({ ...next, type: MOTION_PREVIEW_STATE, instance: 'doc-b', state: { ...state, time: 0 } });
  expect(transport!.getState()?.time).toBe(0);
});

it('fences source-attribute changes before MutationObserver delivery and current-frame changes before effects', () => {
  const { connect, frame, send, setIdentity } = setup(); const hello = connect();
  frame.setAttribute('srcdoc', '<p>new file</p>');
  expect(transport!.getDocumentToken()).toBeNull();
  send({ ...hello, requestId: null, instance: 'doc-a', state });
  expect(transport!.getState()).toBeNull();
  frame.dispatchEvent(new Event('load'));
  connect(); setIdentity('file-b');
  expect(transport!.getDocumentToken()).toBeNull();
  expect(transport!.getState()).toBeNull();
});

it('times out commands and requires valid finite clock values', async () => {
  const { connect } = setup(); connect();
  const timeout = expect(transport!.command({ action: 'pause' })).rejects.toThrow('motion.commandFailed');
  await vi.advanceTimersByTimeAsync(2500); await timeout;
  expect(transport!.getSnapshot().error).toBe('motion.commandFailed');
  expect(isMotionPlayerState({ ...state, time: NaN })).toBe(false);
  expect(isMotionPlayerState({ ...state, fps: 241 })).toBe(false);
  expect(isMotionPlayerState({ ...state, time: 9 })).toBe(false);
  expect(isMotionPlayerState({ ...state, userMuted: 'true' })).toBe(false);
});

it('waits for a new document when content identity changes before iframe attributes do', () => {
  const { frame, outgoing, connect, setIdentity, send, handshake } = setup(); const old = connect();
  outgoing.mockClear(); setIdentity('file-b');
  transport!.bind(frame, 'file-b', true);
  expect(outgoing).not.toHaveBeenCalled();
  expect(transport!.getDocumentToken()).toBeNull();
  send({ ...old, type: MOTION_PREVIEW_STATE, instance: 'doc-a', state });
  expect(transport!.getState()).toBeNull();
  frame.setAttribute('srcdoc', '<p>new source</p>'); frame.dispatchEvent(new Event('load'));
  const next = handshake();
  send({ ...next, type: MOTION_PREVIEW_STATE, instance: 'doc-b', state: { ...state, time: 0 } });
  expect(transport!.getState()?.time).toBe(0);
});

it('reactivates the same document without requiring navigation', () => {
  const { frame, connect, setEnabled, handshake } = setup(); const original = connect();
  setEnabled(false); transport!.bind(frame, 'file-a', false);
  expect(transport!.getDocumentToken()).toBeNull();
  setEnabled(true); transport!.bind(frame, 'file-a', true);
  expect(handshake().clientId).not.toBe(original.clientId);
  connect(); expect(transport!.getState()?.time).toBe(2.4);
});

it('records navigation while disabled so activation can reconnect after the load already completed', () => {
  const { frame, connect, outgoing, setIdentity, setEnabled } = setup(); connect();
  setIdentity('file-b'); setEnabled(false); transport!.bind(frame, 'file-b', false);
  outgoing.mockClear(); frame.setAttribute('srcdoc', '<p>new source</p>'); frame.dispatchEvent(new Event('load'));
  expect(outgoing).not.toHaveBeenCalled();
  setEnabled(true); transport!.bind(frame, 'file-b', true);
  connect(); expect(transport!.getState()?.time).toBe(2.4);
});

it('uses the render identity if a load completes before its binding effect', () => {
  const { frame, connect, setIdentity } = setup(); connect();
  setIdentity('file-b'); frame.setAttribute('srcdoc', '<p>new source</p>'); frame.dispatchEvent(new Event('load'));
  transport!.bind(frame, 'file-b', true);
  connect(); expect(transport!.getState()?.time).toBe(2.4);
});

it('allows a parked iframe to reconnect after its background load completed', () => {
  const { frame, connect, setFrame, setIdentity } = setup(); connect();
  const other = document.createElement('iframe'); document.body.appendChild(other);
  vi.spyOn(other.contentWindow!, 'postMessage').mockImplementation(() => {});
  setFrame(other); setIdentity('file-b'); transport!.bind(other, 'file-b', true);
  frame.setAttribute('srcdoc', '<p>background source</p>'); frame.dispatchEvent(new Event('load'));
  setFrame(frame); setIdentity('file-a-new'); transport!.bind(frame, 'file-a-new', true);
  connect(); expect(transport!.getState()?.time).toBe(2.4);
});

it('restores a confirmed paused moment and annotation lock when the same content changes preview transport', () => {
  const { frame, connect, handshake, outgoing, setIdentity, send } = setup('content-a');
  const paused = { ...state, playing: false, locked: true, time: 2.5 };
  connect(paused); transport!.invalidate(); setIdentity('srcdoc-document');
  transport!.bind(frame, 'srcdoc-document', true, 'content-a');
  frame.setAttribute('srcdoc', '<p>same content</p>'); frame.dispatchEvent(new Event('load'));
  expect(outgoing.mock.calls.at(-1)![0]).toMatchObject({ restore: { time: 2.5, locked: true, muted: false } });
  const hello = handshake();
  send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'doc-b', restored: true, state: paused });
  expect(transport!.getState()).toMatchObject({ time: 2.5, locked: true, playing: false });
});

it('never restores an earlier paused clock into changed content or another file', () => {
  const { frame, connect, outgoing, setIdentity, setContentIdentity } = setup('content-a');
  connect({ ...state, playing: false, locked: true, time: 2.5 });
  setIdentity('next-document'); setContentIdentity('content-b');
  transport!.bind(frame, 'next-document', true, 'content-b');
  frame.setAttribute('srcdoc', '<p>changed source</p>'); frame.dispatchEvent(new Event('load'));
  expect(outgoing.mock.calls.at(-1)![0]).not.toHaveProperty('restore');
  connect({ ...state, time: 0 }); expect(transport!.getState()?.time).toBe(0);
});

it('does not accept an old player that acknowledges a restore without actually applying it', () => {
  const { frame, connect, handshake, setIdentity, send } = setup('content-a');
  connect({ ...state, playing: false, locked: true, time: 2.5 });
  setIdentity('next-document'); transport!.bind(frame, 'next-document', true, 'content-a');
  frame.dispatchEvent(new Event('load'));
  const hello = handshake();
  send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'doc-b', state: { ...state, time: 0 } });
  expect(transport!.getDocumentToken()).toBeNull();
  send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'doc-b', restored: true, state: { ...state, time: 0 } });
  expect(transport!.getState()).toBeNull();
});

it.each([undefined, false, true])('restores user mute=%s independently from effective host mute', userMuted => {
  const { frame, connect, outgoing, setIdentity } = setup('content-a');
  const paused = { ...state, playing: false, muted: true, userMuted };
  connect(paused); transport!.invalidate(); setIdentity('next-document');
  transport!.bind(frame, 'next-document', true, 'content-a');
  frame.dispatchEvent(new Event('load'));
  expect(outgoing.mock.calls.at(-1)![0]).toMatchObject({ restore: { time: 2.4, locked: false, muted: userMuted ?? false } });
});
