// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MotionEditorDocument, MotionEditorObject } from '@open-design/contracts';
import { MOTION_PREVIEW_ACTIVITY, MOTION_PREVIEW_REQUEST } from '@open-design/contracts/runtime/motion-source-player';
import { MotionObjectEditor } from '../../src/components/MotionObjectEditor';

const mocks = vi.hoisted(() => ({ request: vi.fn(), preview: vi.fn(), command: vi.fn(), t: (key: string) => key,
  state: { time: 2, duration: 6, fps: 30, active: true, playing: false, muted: false, locked: false } }));
vi.mock('../../src/i18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('../../src/providers/motion-editor', () => ({ requestMotionEditor: mocks.request, previewMotionEditor: mocks.preview }));
vi.mock('../../src/runtime/srcdoc', () => ({ buildSrcdoc: (source: string) => source }));
vi.mock('../../src/runtime/motion-preview-transport', () => ({ useMotionPreviewTransport: () => ({
  state: mocks.state, connected: true, error: null, command: mocks.command, getState: () => mocks.state, onLoad: vi.fn(),
}) }));
vi.mock('../../src/components/MotionPlaybackControls', () => ({ motionStepTime: (time: number, _duration: number, fps: number, direction: number) => time + direction / fps }));

const object = (id: string, start: number): MotionEditorObject => ({ id, name: id, type: 'text', text: `Text ${id}`,
  x: 20, y: 30, width: 300, height: 80, fontSize: 24, color: '#ffffff', fill: '#000000', rotation: 0, opacity: 1,
  animation: { preset: 'rise', start, duration: 1, easing: 'gentle' },
});
const fixture = (): MotionEditorDocument => ({ schemaVersion: 1, width: 1280, height: 720,
  duration: 6, fps: 30, background: '#202020', objects: [object('title', .5), object('body', 1.5), object('logo', 2.5)] });
const response = (document = fixture(), revision = 'revision-1', source = '<html>original</html>') => ({ supported: true as const, document, revision, source });
const saveCalls = () => mocks.request.mock.calls.filter(call => call[3]);
const clickLayer = (name: string, shiftKey = false) => fireEvent.click(screen.getAllByRole('button', { name })[0]!, { shiftKey });
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'motion.editor.apply' }));

beforeEach(() => {
  mocks.request.mockReset(); mocks.command.mockReset().mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(response());
  mocks.preview.mockReset().mockResolvedValue({ source: '<html>original</html>' });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function open(expand = true, initialTime?: number) {
  const onSaved = vi.fn(), onClose = vi.fn();
  const { unmount } = render(<MotionObjectEditor projectId="project" filePath="index.html" baseHref="/project/" initialTime={initialTime} onSaved={onSaved} onClose={onClose} />);
  await screen.findByTitle('motion.editor.preview');
  if (expand) fireEvent.click(screen.getByRole('button', { name: 'motion.editor.expandTimeline' }));
  return { onSaved, onClose, unmount };
}

it('activates its real preview window, ignores foreign requests, and disposes the activity binding on unmount', async () => {
  const { unmount } = await open();
  const frame = screen.getByTitle('motion.editor.preview') as HTMLIFrameElement;
  expect(frame).toHaveAttribute('data-od-motion-active', 'true');
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const request = (id: string, source: MessageEventSource | null) => {
    window.dispatchEvent(new MessageEvent('message', { source, data: { type: MOTION_PREVIEW_REQUEST, id } }));
  };
  await waitFor(() => {
    request('editor-document', frame.contentWindow);
    expect(post).toHaveBeenLastCalledWith({ type: MOTION_PREVIEW_ACTIVITY, id: 'editor-document', active: true }, '*');
  });
  post.mockClear();
  request('foreign-document', window);
  expect(post).not.toHaveBeenCalled();
  unmount();
  // Reattach the same iframe after disposal so a leaked host listener could
  // still match frame.contentWindow. A detached-frame null check alone would
  // otherwise make this lifecycle assertion pass even without unbinding.
  document.body.appendChild(frame);
  const afterUnmountPost = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  request('after-unmount', frame.contentWindow);
  fireEvent.load(frame);
  expect(afterUnmountPost).not.toHaveBeenCalled();
  frame.remove();
});

it('retains the draft and saved preview after save failure and blocks selection until discard', async () => {
  const { onSaved, onClose } = await open();
  clickLayer('title');
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Changed title' } });
  clickLayer('body');
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Changed title');
  expect(screen.getByRole('alert')).toHaveTextContent('motion.editor.pending');
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.back' }));
  expect(onClose).not.toHaveBeenCalled();
  mocks.request.mockRejectedValueOnce(new Error('Source revision mismatch'));
  apply();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Source revision mismatch'));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>original</html>');
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Changed title');
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('motion.editor.unsaved'));
  expect(screen.getByRole('button', { name: 'motion.editor.reload' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.discard' }));
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Text title');
  expect(screen.getByRole('status')).toHaveTextContent('motion.editor.saved');
  clickLayer('body');
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Text body');
});

it('saves, undoes and redoes through the same API using each returned revision', async () => {
  const { onSaved } = await open();
  clickLayer('title');
  const original = fixture(), changed = fixture(); changed.objects[0]!.text = 'New title';
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'New title' } });
  mocks.request.mockResolvedValueOnce(response(changed, 'revision-2', '<html>changed</html>'));
  apply();
  await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith('<html>changed</html>'));
  expect(saveCalls()[0]![3]).toMatchObject({ baseRevision: 'revision-1', document: changed });
  mocks.request.mockResolvedValueOnce(response(original, 'revision-3', '<html>original restored</html>'));
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.undo' }));
  await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith('<html>original restored</html>'));
  expect(saveCalls()[1]![3]).toMatchObject({ baseRevision: 'revision-2', document: original });
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Text title');
  mocks.request.mockResolvedValueOnce(response(changed, 'revision-4', '<html>redone</html>'));
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.redo' }));
  await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith('<html>redone</html>'));
  expect(saveCalls()[2]![3]).toMatchObject({ baseRevision: 'revision-3', document: changed });
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('New title');
});

it('reloads the current source after a revision conflict and drops obsolete draft state', async () => {
  await open(); clickLayer('title');
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Old draft' } });
  mocks.request.mockRejectedValueOnce(new Error('Revision conflict')); apply();
  await screen.findByText(/Revision conflict/);
  const latest = fixture(); latest.objects[0]!.text = 'External change';
  mocks.request.mockResolvedValueOnce(response(latest, 'revision-external', '<html>external</html>'));
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.reload' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('External change'));
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>external</html>');
  expect(screen.getByRole('button', { name: 'motion.editor.undo' })).toBeDisabled();
});

it('validates the entire stagger before saving and preserves explicit selection order', async () => {
  await open(); clickLayer('logo'); clickLayer('title', true); clickLayer('body', true);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'motion.editor.interval' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.stagger' }));
  expect(screen.getByRole('alert')).toHaveTextContent('motion.editor.invalid');
  expect(saveCalls()).toHaveLength(0);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'motion.editor.interval' }), { target: { value: '.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.stagger' }));
  await waitFor(() => expect(saveCalls()).toHaveLength(1));
  expect(saveCalls()[0]![3].document.objects.map((item: MotionEditorObject) => item.animation.start)).toEqual([2.7, 2.9, 2.5]);
});

it('ignores playback shortcuts while editing text and keeps invalid timing away from the API', async () => {
  await open(); clickLayer('title'); mocks.command.mockClear();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'motion.editor.text' }), { key: ' ' });
  expect(mocks.command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'motion.editor.animation' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'motion.editor.duration' }), { target: { value: '8' } });
  apply();
  expect(screen.getByRole('alert')).toHaveTextContent('motion.editor.invalid');
  expect(saveCalls()).toHaveLength(0);
});

it('selects a timeline clip and commits a drag once on release, preserving other objects', async () => {
  await open();
  const clip = screen.getByRole('button', { name: 'title · motion.editor.entrance' });
  Object.defineProperty(clip, 'setPointerCapture', { value: vi.fn(), configurable: true });
  vi.spyOn(clip.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 30, x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 30, toJSON: () => ({}) });
  fireEvent.pointerDown(clip, { button: 0, clientX: 100 });
  expect(clip).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('tab', { name: 'motion.editor.animation' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.pointerMove(clip, { clientX: 150 });
  fireEvent.pointerMove(clip, { clientX: 200 });
  expect(saveCalls()).toHaveLength(0);
  fireEvent.pointerUp(clip, { clientX: 200 });
  await waitFor(() => expect(saveCalls()).toHaveLength(1));
  expect(saveCalls()[0]![3].document.objects.map((item: MotionEditorObject) => item.animation.start)).toEqual([1.5, 1.5, 2.5]);
  expect(saveCalls()[0]![3].document.objects[1]).toEqual(fixture().objects[1]);
});

it('cancels a pending timeline drag with Escape without saving or closing', async () => {
  const { onClose } = await open();
  const clip = screen.getByRole('button', { name: 'title · motion.editor.entrance' });
  Object.defineProperty(clip, 'setPointerCapture', { value: vi.fn(), configurable: true });
  vi.spyOn(clip.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 30, x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 30, toJSON: () => ({}) });
  fireEvent.pointerDown(clip, { button: 0, clientX: 100 });
  fireEvent.pointerMove(clip, { clientX: 200 });
  fireEvent.keyDown(clip, { key: 'Escape' });
  fireEvent.pointerUp(clip, { clientX: 200 });
  expect(screen.getByRole('spinbutton', { name: 'motion.editor.start' })).toHaveValue(.5);
  expect(saveCalls()).toHaveLength(0);
  expect(onClose).not.toHaveBeenCalled();
});

it('does not silently commit the last valid position when a drag ends outside the scene', async () => {
  await open();
  const clip = screen.getByRole('button', { name: 'title · motion.editor.entrance' });
  Object.defineProperty(clip, 'setPointerCapture', { value: vi.fn(), configurable: true });
  vi.spyOn(clip.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 30, x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 30, toJSON: () => ({}) });
  fireEvent.pointerDown(clip, { button: 0, clientX: 100 });
  fireEvent.pointerMove(clip, { clientX: 200 });
  fireEvent.pointerMove(clip, { clientX: 900 });
  fireEvent.pointerUp(clip, { clientX: 900 });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('motion.editor.invalid'));
  expect(saveCalls()).toHaveLength(0);
  expect(screen.getByRole('spinbutton', { name: 'motion.editor.start' })).toHaveValue(.5);
});

it('shows unsupported-source fallback without rendering editable fields', async () => {
  mocks.request.mockResolvedValue({ supported: false, reason: 'Unknown renderer version' });
  const onClose = vi.fn();
  render(<MotionObjectEditor projectId="project" filePath="index.html" baseHref="/project/" onSaved={vi.fn()} onClose={onClose} />);
  await screen.findByText('motion.editor.unsupported');
  expect(screen.queryByRole('button', { name: 'motion.editor.apply' })).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Unknown renderer version');
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.back' })); expect(onClose).toHaveBeenCalledOnce();
});

it('previews a candidate without saving and restores the persisted source when discarded', async () => {
  mocks.preview.mockResolvedValue({ source: '<html>candidate title</html>' });
  const { onSaved } = await open(); clickLayer('title');
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Candidate title' } });
  await waitFor(() => expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>candidate title</html>'));
  expect(mocks.preview).toHaveBeenCalledOnce();
  expect(mocks.preview.mock.calls[0]?.[2]).toBe('revision-1');
  expect(mocks.preview.mock.calls[0]?.[3].objects[0].text).toBe('Candidate title');
  expect(saveCalls()).toHaveLength(0);
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('motion.editor.unsaved');
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.discard' }));
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>original</html>');
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Text title');
  expect(screen.getByRole('status')).toHaveTextContent('motion.editor.saved');
  expect(saveCalls()).toHaveLength(0);
});

it('ignores an older preview response after a newer draft and after discard', async () => {
  let resolveOld!: (value: { source: string }) => void;
  let resolveNew!: (value: { source: string }) => void;
  mocks.preview.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  const { onSaved } = await open(); clickLayer('title');
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Old candidate' } });
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  const oldSignal = mocks.preview.mock.calls[0]?.[5] as AbortSignal;
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'New candidate' } });
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { resolveNew({ source: '<html>new candidate</html>' }); });
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>new candidate</html>');
  await act(async () => { resolveOld({ source: '<html>old candidate</html>' }); });
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>new candidate</html>');
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('New candidate');
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.discard' }));
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>original</html>');
  let resolveDiscarded!: (value: { source: string }) => void;
  mocks.preview.mockImplementationOnce(() => new Promise(resolve => { resolveDiscarded = resolve; }));
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Discarded candidate' } });
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.discard' }));
  await act(async () => { resolveDiscarded({ source: '<html>discarded</html>' }); });
  expect(screen.getByTitle('motion.editor.preview')).toHaveAttribute('srcdoc', '<html>original</html>');
  expect(saveCalls()).toHaveLength(0); expect(onSaved).not.toHaveBeenCalled();
});


it('keeps appearance focused and reveals animation tracks without losing the current draft', async () => {
  await open(false);
  expect(screen.queryByRole('button', { name: 'title · motion.editor.entrance' })).toBeNull();
  expect(screen.getByRole('button', { name: 'motion.editor.expandTimeline' })).toHaveAttribute('aria-expanded', 'false');
  clickLayer('title');
  fireEvent.change(screen.getByRole('textbox', { name: 'motion.editor.text' }), { target: { value: 'Unsaved title' } });
  fireEvent.click(screen.getByRole('tab', { name: 'motion.editor.animation' }));
  expect(screen.getByRole('button', { name: 'title · motion.editor.entrance' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'motion.editor.collapseTimeline' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'motion.editor.appearance' }));
  expect(screen.queryByRole('button', { name: 'title · motion.editor.entrance' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'motion.editor.text' })).toHaveValue('Unsaved title');
  expect(saveCalls()).toHaveLength(0);
});

it('filters tracks only on request and keeps the object list available to change the selection', async () => {
  await open();
  expect(screen.getByRole('button', { name: 'motion.editor.onlySelected' })).toBeDisabled();
  clickLayer('title');
  expect(screen.getByRole('button', { name: 'body · motion.editor.entrance' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.onlySelected' }));
  expect(screen.queryByRole('button', { name: 'body · motion.editor.entrance' })).toBeNull();
  expect(screen.getByRole('button', { name: 'motion.editor.showAll' })).toHaveAttribute('aria-pressed', 'true');
  clickLayer('body');
  expect(screen.getByRole('button', { name: 'body · motion.editor.entrance' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'title · motion.editor.entrance' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.showAll' }));
  expect(screen.getByRole('button', { name: 'title · motion.editor.entrance' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'logo · motion.editor.entrance' })).toBeInTheDocument();
});

it('preserves the incoming time and requires an explicit action to locate the selected object', async () => {
  const { onClose } = await open(false, 4.25);
  expect(mocks.command).toHaveBeenCalledWith({ action: 'seek', time: 4.25 });
  mocks.command.mockClear();
  clickLayer('title');
  expect(mocks.command.mock.calls.some(([control]) => control.action === 'seek')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.locateAppearance' }));
  expect(mocks.command).toHaveBeenLastCalledWith({ action: 'seek', time: 1.5 });
  fireEvent.click(screen.getByRole('tab', { name: 'motion.editor.animation' }));
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.locateEntrance' }));
  expect(mocks.command).toHaveBeenLastCalledWith({ action: 'seek', time: .5 });
  fireEvent.click(screen.getByRole('button', { name: 'motion.editor.back' }));
  expect(onClose).toHaveBeenCalledWith(mocks.state.time);
});
