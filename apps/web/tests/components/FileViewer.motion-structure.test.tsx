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

async function setup(options: { acceptSend?: boolean } = {}) {
  const inspections: { filePath: string; source: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/motion/structure')) {
      const request = JSON.parse(String(init?.body)) as { filePath: string; source: string };
      inspections.push(request);
      return Response.json(inspection(request.source));
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
    <FileViewer projectId="motion-structure-integration" projectKind="video" file={file} liveHtml={source}
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
  const validateTitle = async (index = 0) => {
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
  const createDraft = async () => {
    fireEvent.click(sceneButton(3)); await acknowledge(0);
    fireEvent.click(textButton()); await acknowledge(1);
    fireEvent.click(screen.getByRole('button', { name: 'Annotate & refine' })); await acknowledge(2);
    await validateTitle(); await acknowledge(3);
    await waitFor(() => expect(screen.getByTestId('comment-popover-input')).toBeInTheDocument());
  };
  await waitFor(() => expect(sceneButton(3)).toBeEnabled());
  expect(within(screen.getByTestId('motion-scenes')).getAllByRole('button')).toHaveLength(5);
  return { view, tree, frame, commands, validations, snapshots, inspections, save, sendToChat,
    sceneButton, textButton, acknowledge, validateTitle, createDraft, message, getState: () => state };
}

it('waits for seek/pause and strict target acknowledgements before opening the real title in the existing composer', async () => {
  const { commands, inspections, sceneButton, textButton, acknowledge, validateTitle, message } = await setup();
  expect(inspections).toContainEqual({ filePath: file.name, source: html });
  expect(sceneButton(1)).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(sceneButton(3));
  expect(commands[0]?.control).toEqual({ action: 'seek', time: 6.5 });
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('button', { name: `Select text: ${scenes[2]!.title}` })).toBeNull();
  await act(async () => {
    message({ ...commands[0], type: MOTION_PREVIEW_STATE, requestId: 'unrelated-request',
      state: { active: true, playing: false, time: 6.5, duration: 12, fps: 30, locked: false, muted: false } });
  });
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'false');
  await acknowledge(0);
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(textButton());
  expect(commands[1]?.control).toEqual({ action: 'pause' });
  expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  await acknowledge(1);
  expect(textButton()).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Annotate & refine' }));
  await acknowledge(2);
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await validateTitle();
  expect(commands[3]?.control).toEqual({ action: 'lock', value: true });
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await acknowledge(3);
  const input = await screen.findByTestId('comment-popover-input');
  expect(input).toHaveValue(`Scene “Product features” (5.000–8.000s), target “${scenes[2]!.title}”:\n`);
  expect(screen.getByTestId('comment-active-pin')).toHaveStyle({ left: '120px', top: '210px' });
  expect(screen.getByTestId('comment-popover-save')).toBeEnabled();
  expect(screen.getByTestId('comment-add-send')).toBeEnabled();
});

it('holds the current draft and clock on the first scene switch, then retargets only after confirmation', async () => {
  const { sceneButton, commands, acknowledge, createDraft, getState } = await setup();
  await createDraft();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Keep this unsent title edit.' } });
  fireEvent.click(sceneButton(4));
  expect(commands).toHaveLength(4);
  expect(getState().time).toBe(6.5);
  expect(sceneButton(3)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Keep this unsent title edit.');
  expect(screen.getByText('You have an unsent comment. Click again to discard it and switch.')).toBeInTheDocument();
  fireEvent.click(sceneButton(4));
  expect(commands[4]?.control).toEqual({ action: 'lock', value: false });
  await acknowledge(4);
  expect(commands[5]?.control).toEqual({ action: 'seek', time: 9 });
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Keep this unsent title edit.');
  await acknowledge(5);
  expect(sceneButton(4)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
});

it('returns a successfully sent structure request to the live result instead of freezing the old composition', async () => {
  const { view, tree, commands, snapshots, inspections, sendToChat, createDraft, validateTitle, acknowledge, message } = await setup({ acceptSend: true });
  await createDraft();
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Reduce this title from 72px to 68px.' } });
  fireEvent.click(screen.getByTestId('comment-add-send'));
  await validateTitle(1);
  await waitFor(() => expect(snapshots).toHaveLength(1));
  // A one-pixel protocol fixture proves submission/lifecycle behavior, not rendered image quality.
  await act(async () => { message({ type: 'od:snapshot:result', id: snapshots[0]!.id, dataUrl: snapshotDataUrl, w: 1, h: 1 }); });
  await waitFor(() => expect(sendToChat).toHaveBeenCalledOnce());
  expect(sendToChat.mock.calls[0]![0]).toEqual([expect.objectContaining({
    selector: '#title-3', comment: 'Reduce this title from 72px to 68px.',
    motion: { timeSeconds: 6.5, durationSeconds: 12, fps: 30, sourceFingerprint: motionSourceFingerprint(html) },
  })]);
  expect(sendToChat.mock.calls[0]![1]).toEqual([expect.objectContaining({ type: 'image/png', name: expect.stringMatching(/^motion-6\.500s-/) })]);
  await waitFor(() => expect(screen.queryByTestId('comment-popover-input')).toBeNull());
  expect(screen.getByTestId('comment-panel-toggle')).toHaveAttribute('aria-pressed', 'false');
  await waitFor(() => expect(commands[4]?.control).toEqual({ action: 'lock', value: false }));
  await acknowledge(4);

  const nextHtml = html.replace(scenes[2]!.title, 'The newly edited title.');
  view.rerender(tree(nextHtml));
  await waitFor(() => expect(inspections.at(-1)?.source).toBe(nextHtml));
  expect(await screen.findByTestId('motion-scenes')).toBeInTheDocument();
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
});

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
