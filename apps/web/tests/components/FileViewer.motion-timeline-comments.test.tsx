// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MOTION_PREVIEW_COMMAND, MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_STATE,
  type MotionPlayerControl, type MotionPlayerState,
} from '@open-design/contracts/runtime/motion-source-player';
import { CollabProvider, type CollabContextValue } from '../../src/collab/collab-context';
import { FileViewer } from '../../src/components/FileViewer';
import type { PreviewComment, ProjectFile } from '../../src/types';

const personal: CollabContextValue = {
  workspaceContext: null, workspaceContextLoading: false, enabled: false,
  member: null, present: [], publishedVersion: null, syncState: 'synced', viewerOnly: false,
  writerAuthority: 'allowed', isOwner: true, isEffectiveOwner: true, isSharedNonOwner: false,
  ownerDisplayName: null, ownerRole: null, downloadPending: false,
  reportChange() {}, requestPublish() {}, refreshPresence() {}, checkStatusNow() {},
};
const html = '<!doctype html><html><head><meta name="od-motion-output" content="video"></head><body><main data-composition-id="review" data-duration="8" data-width="1280" data-height="720"><h1 id="title">Motion title</h1><p id="subtitle">Motion subtitle</p></main></body></html>';
// Fingerprint of this authored fixture, before any preview bridge injection.
const sourceFingerprint = '264:1ed5bf7e';
const file: ProjectFile = { name: 'motion.html', path: 'motion.html', type: 'file', size: html.length,
  mtime: 1, kind: 'html', mime: 'text/html' };
const first: PreviewComment = {
  id: 'title-feedback', projectId: 'motion-timeline', conversationId: 'c', filePath: file.name,
  elementId: 'title', selector: '#title', label: 'Title', text: 'Motion title',
  htmlHint: '<h1 id="title">Motion title</h1>', position: { x: 40, y: 60, width: 200, height: 40 },
  note: 'Keep this title visible longer', status: 'open', createdAt: 1, updatedAt: 1, pinSeq: 1,
  attachments: [{ path: 'review/title.png', name: 'Title reference' }],
  motion: { timeSeconds: 2, durationSeconds: 8, fps: 30, sourceFingerprint },
};
const second: PreviewComment = {
  ...first, id: 'subtitle-feedback', elementId: 'subtitle', selector: '#subtitle', label: 'Subtitle',
  text: 'Motion subtitle', htmlHint: '<p id="subtitle">Motion subtitle</p>',
  note: 'Move this subtitle upward', createdAt: 2, updatedAt: 2, pinSeq: 2,
  motion: { ...first.motion!, timeSeconds: 6 },
};
interface CommandRequest {
  type: typeof MOTION_PREVIEW_COMMAND;
  clientId: string;
  instance: string;
  requestId: string;
  control: MotionPlayerControl;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function setup(comments = [first, second]) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  render(<CollabProvider value={personal}>
    <FileViewer projectId="motion-timeline" projectKind="video" file={file} liveHtml={html} previewComments={comments} />
  </CollabProvider>);
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const commands: CommandRequest[] = [];
  const validations: string[] = [];
  let state: MotionPlayerState = { active: true, playing: false, time: 0, duration: 8, fps: 30, locked: false, muted: false };
  const send = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }));
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((data: unknown) => {
    const message = data as Record<string, unknown>;
    if (message.type === MOTION_PREVIEW_COMMAND) commands.push(message as unknown as CommandRequest);
    if (message.type === 'od:comment-active-target' && message.validateForSave) {
      const target = comments.find(comment => comment.selector === message.selector);
      if (!target) throw new Error(`Unexpected comment target: ${String(message.selector)}`);
      validations.push(target.id);
      queueMicrotask(() => send({ ...target, type: 'od:comment-active-target-update',
        requestId: message.requestId, requestedSelector: target.selector, documentVersion: `url:${frame.src}` }));
    }
  });
  // A fresh load challenges this exact document; ACKs below go through the real transport.
  await act(async () => { fireEvent.load(frame); });
  const hello = post.mock.calls.map(([data]) => data as Record<string, unknown>)
    .reverse().find(message => message.type === MOTION_PREVIEW_CONNECT);
  expect(hello).toBeDefined();
  await act(async () => {
    send({ ...hello, type: MOTION_PREVIEW_STATE, instance: 'motion-review-document', state });
    send({ type: 'od:url-selection-bridge-ready', href: frame.src });
  });

  const marker = (comment: PreviewComment) => screen.getByRole('button', { name: new RegExp(`^Open comment .* · ${comment.note}$`) });
  const acknowledge = async (index: number) => {
    await waitFor(() => expect(commands.length).toBeGreaterThan(index));
    const request = commands[index]!;
    const control = request.control;
    if (control.action === 'lock') state = { ...state, locked: control.value, playing: false };
    else if (control.action === 'seek') state = { ...state, time: control.time, playing: false };
    else throw new Error(`Unexpected playback action: ${control.action}`);
    await act(async () => { send({ ...request, type: MOTION_PREVIEW_STATE, state }); });
  };
  const finishOpen = async (offset: number, comment: PreviewComment) => {
    await acknowledge(offset);
    await acknowledge(offset + 1);
    await acknowledge(offset + 2);
    await waitFor(() => expect(screen.getByTestId('comment-popover-input')).toHaveValue(comment.note));
  };
  await waitFor(() => expect(marker(first)).toBeEnabled());
  return { commands, validations, marker, finishOpen };
}

it('opens the original comment through confirmed unlock/seek/lock and ignores another click while opening', async () => {
  const { commands, validations, marker, finishOpen } = await setup();
  act(() => {
    fireEvent.click(marker(first));
    // Keep both clicks in one render boundary to exercise the synchronous in-flight guard.
    fireEvent.click(marker(second));
  });
  expect(commands.map(request => request.control)).toEqual([{ action: 'lock', value: false }]);
  expect(marker(second)).toBeDisabled();
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  await finishOpen(0, first);
  expect(commands.map(request => request.control)).toEqual([
    { action: 'lock', value: false }, { action: 'seek', time: 2 }, { action: 'lock', value: true },
  ]);
  expect(validations).toEqual([first.id]);
  expect(screen.getByTestId('comment-panel-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('comment-active-pin')).toBeInTheDocument();
  expect(marker(second)).toBeEnabled();
});

it('only exposes open, in-range comments from the current file and source on the timeline', async () => {
  const previousSource = { ...second, id: 'previous-source', note: 'Earlier version feedback',
    motion: { ...second.motion!, sourceFingerprint: 'previous-source' } };
  const anotherFile = { ...second, id: 'another-file', note: 'Other file feedback', filePath: 'other.html' };
  const resolved = { ...second, id: 'resolved', note: 'Resolved feedback', status: 'resolved' as const };
  const outOfRange = { ...second, id: 'out-of-range', note: 'Out of range feedback',
    motion: { ...second.motion!, timeSeconds: 9 } };
  await setup([first, previousSource, anotherFile, resolved, outOfRange]);
  for (const comment of [previousSource, anotherFile, resolved, outOfRange]) {
    expect(screen.queryByRole('button', { name: new RegExp(comment.note) })).toBeNull();
  }
  expect(screen.getByRole('button', { name: new RegExp(first.note) })).toBeEnabled();
});

it('protects an edited comment before switching markers, then confirms the original retarget flow', async () => {
  const { commands, validations, marker, finishOpen } = await setup();
  fireEvent.click(marker(first));
  await finishOpen(0, first);
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'Unsent title revision' } });
  fireEvent.click(marker(second));
  expect(commands).toHaveLength(3);
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Unsent title revision');
  expect(screen.getByText('You have an unsent comment. Click again to discard it and switch.')).toBeInTheDocument();
  expect(validations).toEqual([first.id]);

  fireEvent.click(marker(second));
  await finishOpen(3, second);
  expect(commands.slice(3).map(request => request.control)).toEqual([
    { action: 'lock', value: false }, { action: 'seek', time: 6 }, { action: 'lock', value: true },
  ]);
  expect(validations).toEqual([first.id, second.id]);
  expect(screen.queryByText('You have an unsent comment. Click again to discard it and switch.')).toBeNull();
});
