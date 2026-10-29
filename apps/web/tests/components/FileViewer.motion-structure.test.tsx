// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { motionSourceFingerprint, type ChatCommentAttachment, type MotionStructureResponse } from '@open-design/contracts';
import {
  MOTION_PREVIEW_COMMAND, MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_STATE,
  type MotionPlayerControl, type MotionPlayerState,
} from '@open-design/contracts/runtime/motion-source-player';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { FileViewer } from '../../src/components/FileViewer';
import type { CommentSendResult } from '../../src/components/comment-send-result';
import type { ProjectFile } from '../../src/types';

const personal: CollabContextValue = {
  workspaceContext: null, workspaceContextLoading: false, enabled: false,
  member: null, present: [], publishedVersion: null, syncState: 'synced', viewerOnly: false,
  writerAuthority: 'allowed', isOwner: true, isEffectiveOwner: true, isSharedNonOwner: false,
  ownerDisplayName: null, ownerRole: null, downloadPending: false,
  reportChange() {}, requestPublish() {}, refreshPresence() {}, checkStatusNow() {},
};
const scenes = [
  { label: 'Problem', start: 0, duration: 2, title: 'Choose a better cushion.' },
  { label: 'Measure first', start: 2, duration: 3, title: 'Measure before you order.' },
  { label: 'Product features', start: 5, duration: 3, title: 'Built for everyday patio use.' },
  { label: 'Fit confidence', start: 8, duration: 2, title: 'Check the fit.' },
  { label: 'Call to action', start: 10, duration: 2, title: 'Make yourself comfortable.' },
];
// A static five-scene fixture, not a model-generated result or a copy of an experimental artifact.
const html = '<!doctype html><html><head><meta name="od-motion-output" content="video"></head><body>'
  + '<main data-composition-id="review" data-start="0" data-duration="12" data-width="1920" data-height="1080">'
  + scenes.map((scene, index) => `<section id="scene-${index + 1}" data-start="${scene.start}" data-duration="${scene.duration}" aria-label="${scene.label}"><h2 id="title-${index + 1}">${scene.title}</h2></section>`).join('')
  + '</main></body></html>';
const file: ProjectFile = { name: 'motion.html', path: 'motion.html', type: 'file', size: html.length,
  mtime: 1, kind: 'html', mime: 'text/html' };

function inspection(source: string): MotionStructureResponse {
  return {
    sourceFingerprint: motionSourceFingerprint(source),
    composition: { id: 'review', duration: 12, width: 1920, height: 1080 },
    scenes: scenes.map((scene, index) => ({ id: `scene-${index + 1}`, kind: 'scene', label: scene.label,
      start: scene.start, duration: scene.duration, selector: `#scene-${index + 1}` })),
    texts: scenes.map((scene, index) => ({ id: `title-${index + 1}`, kind: 'text', label: scene.title,
      text: scene.title, sceneId: `scene-${index + 1}`, selector: `#title-${index + 1}` })),
    audio: [], captions: [], warnings: [],
  };
}
interface CommandRequest {
  type: typeof MOTION_PREVIEW_COMMAND;
  clientId: string;
  instance: string;
  requestId: string;
  control: MotionPlayerControl;
}
interface ValidationRequest { requestId: string; selector: string; validateForSave: boolean; strictMotion?: boolean; }
const snapshotDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJwAAAABJRU5ErkJggg==';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

async function setup(options: { acceptSend?: boolean; noScenes?: boolean } = {}) {
  const inspections: { filePath: string; source: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/motion/structure')) {
      const request = JSON.parse(String(init?.body)) as { filePath: string; source: string };
      inspections.push(request);
      const result = inspection(request.source);
      return Response.json(options.noScenes ? { ...result, composition: null, scenes: [], texts: [] } : result);
    }
    if (String(input) === snapshotDataUrl) return new Response(Uint8Array.from(atob(snapshotDataUrl.split(',')[1]!), character => character.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } });
    return Response.json({});
  }));
  const save = vi.fn(async () => null);
  const sendToChat = vi.fn(async (attachments: ChatCommentAttachment[], _images?: File[]): Promise<CommentSendResult> => ({
    status: options.acceptSend ? 'accepted' : 'rejected', commentIds: options.acceptSend ? attachments.map(attachment => attachment.id) : [],
  }));
  const tree = (source: string) => <CollabProvider value={personal}>
    <FileViewer projectId="motion-structure-integration" projectKind="video" motionTask file={file} liveHtml={source}
      onSavePreviewComment={save} onSendBoardCommentAttachments={sendToChat} />
  </CollabProvider>;
  const view = render(tree(html));
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  expect(frame).toHaveAttribute('data-od-render-mode', 'url-load');
  const commands: CommandRequest[] = [];
  const validations: ValidationRequest[] = [];
  const snapshots: { id: string }[] = [];
  let state: MotionPlayerState = { active: true, playing: true, time: 0, duration: 12, fps: 30, locked: false, muted: false };
  const message = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }));
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((data: unknown) => {
    const request = data as Record<string, unknown>;
    if (request.type === MOTION_PREVIEW_COMMAND) commands.push(request as unknown as CommandRequest);
    if (request.type === 'od:comment-active-target' && request.validateForSave) validations.push(request as unknown as ValidationRequest);
    if (request.type === 'od:snapshot') snapshots.push(request as unknown as { id: string });
  });
  await act(async () => { fireEvent.load(frame); });
  const hello = post.mock.calls.map(([data]) => data as Record<string, unknown>)
    .reverse().find(request => request.type === MOTION_PREVIEW_CONNECT);
  expect(hello).toBeDefined();
  await act(async () => {
    message({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'motion-structure-document', state });
    message({ type: 'od:url-selection-bridge-ready', href: frame.src });
  });
  const sceneButton = (number: number) => screen.getByRole('button', { name: new RegExp(`^Select scene ${number} ·`) });
  const textButton = () => screen.getByRole('button', { name: `Select text: ${scenes[2]!.title}` });
  const acknowledge = async (index: number) => {
    await waitFor(() => expect(commands.length).toBeGreaterThan(index));
    const request = commands[index]!, control = request.control;
    if (control.action === 'seek') state = { ...state, time: control.time, playing: false };
    else if (control.action === 'pause') state = { ...state, playing: false };
    else if (control.action === 'lock') state = { ...state, locked: control.value, playing: false };
    else throw new Error(`Unexpected action: ${control.action}`);
    await act(async () => { message({ ...request, type: MOTION_PREVIEW_STATE, state }); });
  };
  const validateTitle = async (index = 1) => {
    await waitFor(() => expect(validations.length).toBeGreaterThan(index));
    const request = validations[index]!;
    expect(request).toMatchObject({ selector: '#title-3', validateForSave: true, strictMotion: true });
    await act(async () => { message({
      type: 'od:comment-active-target-update', requestId: request.requestId, documentVersion: `url:${frame.src}`,
      requestedSelector: request.selector, elementId: 'live-title-3', selector: '#title-3', label: 'h2',
      text: scenes[2]!.title, htmlHint: '<h2 id="title-3">',
      position: { x: 120, y: 210, width: 640, height: 96 }, style: { fontSize: '80px', color: 'rgb(30, 60, 40)' },
    }); });
  };
  const validateFrame = async (index = 0) => {
    await waitFor(() => expect(validations.length).toBeGreaterThan(index));
    const request = validations[index]!;
    expect(request).toMatchObject({ selector: '[data-composition-id="review"]', validateForSave: true, strictMotion: true });
    await act(async () => { message({
      type: 'od:comment-active-target-update', requestId: request.requestId, documentVersion: `url:${frame.src}`,
      requestedSelector: request.selector, elementId: 'motion-current-frame', selector: '[data-composition-id="review"]', label: 'main', text: '', htmlHint: '<main data-composition-id="review">',
      position: { x: 0, y: 0, width: 1920, height: 1080 },
    }); });
  };
  const createDraft = async () => {
    fireEvent.click(sceneButton(3)); await acknowledge(0);
    fireEvent.click(screen.getByRole('button', { name: 'Request change' })); await acknowledge(1);
    await validateFrame(); await acknowledge(2);
    fireEvent.click(screen.getByRole('button', { name: 'Choose element' }));
    fireEvent.click(textButton()); await acknowledge(3); await acknowledge(4);
    await validateTitle(); await acknowledge(5);
    await waitFor(() => expect(screen.getByTestId('comment-popover-input')).toBeInTheDocument());
  };
  await waitFor(() => expect(inspections.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Request change' })).toBeEnabled());
  if (!options.noScenes) {
    await waitFor(() => expect(sceneButton(3)).toBeEnabled());
    expect(within(screen.getByTestId('motion-scenes')).getAllByRole('button')).toHaveLength(5);
  }
  return { view, tree, frame, commands, validations, snapshots, inspections, save, sendToChat,
    sceneButton, textButton, acknowledge, validateTitle, validateFrame, createDraft, message, getState: () => state };
}

it('opens the current frame first and validates an explicitly chosen element before retargeting the composer', async () => {
  const { commands, inspections, sceneButton, textButton, acknowledge, validateTitle, validateFrame, message, sendToChat } = await setup();
  expect(inspections).toContainEqual({ filePath: file.name, source: html });
  fireEvent.click(sceneButton(3));
  expect(commands[0]?.control).toEqual({ action: 'seek', time: 6.5 });
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'false');
  await act(async () => {
    message({ ...commands[0], type: MOTION_PREVIEW_STATE, requestId: 'unrelated-request',
      state: { active: true, playing: false, time: 6.5, duration: 12, fps: 30, locked: false, muted: false } });
  });
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'false');
  await acknowledge(0);
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: `Select text: ${scenes[2]!.title}` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Request change' }));
  await acknowledge(1);
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await validateFrame(); await acknowledge(2);
  expect(screen.getByTestId('motion-feedback-context')).toHaveTextContent('Current frame');
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Choose element' }));
  fireEvent.click(textButton());
  expect(commands[3]?.control).toEqual({ action: 'lock', value: false });
  await acknowledge(3); await acknowledge(4);
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await validateTitle();
  expect(commands[5]?.control).toEqual({ action: 'lock', value: true });
  await acknowledge(5);
  expect(await screen.findByTestId('comment-popover-input')).toHaveValue('');
  expect(screen.getByTestId('motion-feedback-context')).toHaveTextContent(scenes[2]!.title);
  expect(screen.getByTestId('comment-active-pin')).toHaveStyle({ left: '120px', top: '210px' });
  expect(screen.getByTestId('comment-popover-save')).toBeDisabled();
  expect(screen.getByTestId('comment-add-send')).toBeDisabled();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Adjust this title.' } });
  expect(screen.getByTestId('comment-popover-save')).toBeEnabled();
  expect(screen.getByTestId('comment-add-send')).toBeEnabled();
  expect(sendToChat).not.toHaveBeenCalled();
}, 10000);

it('holds the current draft and clock on the first scene switch, then retargets only after confirmation', async () => {
  const { sceneButton, commands, acknowledge, createDraft, getState } = await setup();
  await createDraft();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Keep this unsent title edit.' } });
  fireEvent.click(sceneButton(4));
  expect(commands).toHaveLength(6);
  expect(getState().time).toBe(6.5);
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Keep this unsent title edit.');
  expect(screen.getByText('You have an unsent comment. Click again to discard it and switch.')).toBeInTheDocument();
  fireEvent.click(sceneButton(4));
  expect(commands[6]?.control).toEqual({ action: 'lock', value: false });
  await acknowledge(6);
  expect(commands[7]?.control).toEqual({ action: 'seek', time: 9 });
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Keep this unsent title edit.');
  await acknowledge(7);
  expect(sceneButton(4)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
});

it('returns a successfully sent structure request to the live result instead of freezing the old composition', async () => {
  const { view, tree, commands, snapshots, inspections, sendToChat, createDraft, validateTitle, acknowledge, message } = await setup({ acceptSend: true });
  await createDraft();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Reduce this title from 72px to 68px.' } });
  fireEvent.click(screen.getByTestId('comment-add-send'));
  await validateTitle(2);
  await waitFor(() => expect(snapshots).toHaveLength(1));
  // A one-pixel protocol fixture proves submission/lifecycle behavior, not rendered image quality.
  await act(async () => { message({ type: 'od:snapshot:result', id: snapshots[0]!.id, dataUrl: snapshotDataUrl, w: 1, h: 1 }); });
  await waitFor(() => expect(sendToChat).toHaveBeenCalledOnce());
  expect(sendToChat.mock.calls[0]![0]).toEqual([expect.objectContaining({
    selector: '#title-3', label: scenes[2]!.title, comment: 'Reduce this title from 72px to 68px.',
    motion: { timeSeconds: 6.5, durationSeconds: 12, fps: 30, sourceFingerprint: motionSourceFingerprint(html) },
  })]);
  expect(sendToChat.mock.calls[0]![1]).toEqual([expect.objectContaining({ type: 'image/png', name: expect.stringMatching(/^motion-6\.500s-/) })]);
  await waitFor(() => expect(screen.queryByTestId('comment-popover-input')).toBeNull());
  expect(screen.getByTestId('comment-panel-toggle')).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(commands[6]?.control).toEqual({ action: 'lock', value: false }));
  await acknowledge(6);

  const nextHtml = html.replace(scenes[2]!.title, 'The newly edited title.');
  view.rerender(tree(nextHtml));
  await waitFor(() => expect(inspections.at(-1)?.source).toBe(nextHtml));
  expect(screen.getByRole('region', { name: 'Motion playback' })).toBeInTheDocument();
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
});

it('saves the semantic motion target label while retaining verified geometry and selector', async () => {
  const { createDraft, validateTitle, snapshots, message, save } = await setup();
  await createDraft();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Keep the product title readable.' } });
  fireEvent.click(screen.getByTestId('comment-popover-save'));
  // This live validation deliberately returns the DOM tag label "h2".
  await validateTitle(2);
  await waitFor(() => expect(snapshots).toHaveLength(1));
  await act(async () => { message({ type: 'od:snapshot:result', id: snapshots[0]!.id, dataUrl: snapshotDataUrl, w: 1, h: 1 }); });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    label: scenes[2]!.title, selector: '#title-3', elementId: 'live-title-3',
    position: { x: 120, y: 210, width: 640, height: 96 },
  }), 'Keep the product title readable.', false, expect.any(Array), undefined);
}, 10000);

it.each(['save', 'send'] as const)('keeps a frozen-source draft but blocks %s before validation, capture or downstream submission when liveHtml changes', async action => {
  const { view, tree, frame, validations, snapshots, inspections, save, sendToChat, createDraft } = await setup();
  await createDraft();
  const note = 'My unsent requirement stays available to copy.';
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: note } });
  expect(screen.getByTestId('comment-popover-save')).toBeEnabled();
  expect(screen.getByTestId('comment-add-send')).toBeEnabled();
  const frozenFrameSource = { src: frame.getAttribute('src'), srcdoc: frame.getAttribute('srcdoc') };
  const validatedBefore = validations.length, inspectedBefore = inspections.length;
  view.rerender(tree(html.replace(scenes[2]!.title, 'A newer generated title.')));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('artifact-preview-frame')).toBe(frame);
  expect({ src: frame.getAttribute('src'), srcdoc: frame.getAttribute('srcdoc') }).toEqual(frozenFrameSource);
  expect(screen.getByTestId('comment-popover-input')).toHaveValue(note);
  expect(inspections).toHaveLength(inspectedBefore);
  expect(screen.queryByTestId('motion-scenes')).toBeNull();

  await act(async () => { fireEvent.click(screen.getByTestId(action === 'save' ? 'comment-popover-save' : 'comment-add-send')); });
  expect(screen.getByTestId('comment-popover-input')).toHaveValue(note);
  expect(validations).toHaveLength(validatedBefore);
  expect(snapshots).toHaveLength(0);
  expect(save).not.toHaveBeenCalled();
  expect(sendToChat).not.toHaveBeenCalled();
  expect(screen.getByText('The preview changed. Select the moment again.')).toBeInTheDocument();
});

it('edits the range explicitly in the composer and snapshots the object and range together', async () => {
  const { createDraft, validateTitle, snapshots, message, sendToChat } = await setup();
  await createDraft();
  fireEvent.click(within(screen.getByTestId('motion-feedback-context')).getByRole('button', { name: 'Select time range' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Start (s)' }), { target: { value: '5' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'End (s)' }), { target: { value: '8' } });
  expect(screen.getByTestId('comment-motion-context')).not.toHaveTextContent('5.00–8.00');
  fireEvent.click(screen.getByRole('button', { name: 'Use time range' }));
  expect(screen.getByTestId('comment-motion-context')).toHaveTextContent('5.00–8.00');
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Make the title enter more slowly within this scene.' } });
  fireEvent.click(screen.getByTestId('comment-add-send'));
  await validateTitle(2);
  await waitFor(() => expect(snapshots).toHaveLength(1));
  await act(async () => { message({ type: 'od:snapshot:result', id: snapshots[0]!.id, dataUrl: snapshotDataUrl, w: 1, h: 1 }); });
  await waitFor(() => expect(sendToChat).toHaveBeenCalledOnce());
  expect(sendToChat.mock.calls[0]![0][0]?.motion).toMatchObject({
    timeSeconds: 6.5, durationSeconds: 12, range: { startSeconds: 5, endSeconds: 8 },
  });
});

it('captures and unlocks a real transport reference frame through the viewer integration', async () => {
  const { acknowledge, snapshots, message } = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'More playback tools' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reference frame' }));
  await acknowledge(0);
  await acknowledge(1);
  await waitFor(() => expect(snapshots).toHaveLength(1));
  await act(async () => { message({ type: 'od:snapshot:result', id: snapshots[0]!.id, dataUrl: snapshotDataUrl, w: 1, h: 1 }); });
  await acknowledge(2);
  fireEvent.click(screen.getByRole('button', { name: 'More playback tools' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace reference frame' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Compare frames' })).toBeEnabled();
  expect(screen.queryByText('Could not capture the comparison frame. Please try again.')).toBeNull();
});

it('closing a motion draft clears its temporary range and unlocks playback', async () => {
  const { createDraft, commands, acknowledge, getState } = await setup();
  await createDraft();
  fireEvent.click(within(screen.getByTestId('motion-feedback-context')).getByRole('button', { name: 'Select time range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use time range' }));
  expect(screen.getByTestId('comment-motion-context')).toHaveTextContent('5.50–7.50');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Annotation' })).getByRole('button', { name: 'Close' }));
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await waitFor(() => expect(commands[6]?.control).toEqual({ action: 'lock', value: false }));
  await acknowledge(6);
  expect(getState().locked).toBe(false);
  expect(screen.getByRole('button', { name: 'Select time range' })).toHaveTextContent('Select time range');
  expect(screen.getByRole('button', { name: 'Request change' })).toBeEnabled();
}, 10000);


it('falls back to explicit canvas selection when no reliable scene target exists', async () => {
  const { commands, acknowledge, validations, sendToChat } = await setup({ noScenes: true });
  fireEvent.click(screen.getByRole('button', { name: 'Request change' }));
  await waitFor(() => expect(commands[0]?.control).toEqual({ action: 'lock', value: true }));
  await acknowledge(0);
  expect(validations).toHaveLength(0);
  expect(sendToChat).not.toHaveBeenCalled();
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  expect(screen.getByTestId('comment-panel-toggle')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('comment-panel-toggle'));
  await waitFor(() => expect(commands[1]?.control).toEqual({ action: 'lock', value: false }));
  await acknowledge(1);
  expect(screen.getByRole('button', { name: 'Request change' })).toBeEnabled();
});
