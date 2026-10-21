// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { StandaloneConversationView } from '../../src/components/StandaloneConversationView';
import type { ChatPane } from '../../src/components/ChatPane';
import * as storage from '../../src/state/standalone-conversations';
import { streamViaDaemon, reattachDaemonRun } from '../../src/providers/daemon';

const captured = vi.hoisted(() => ({ pane: null as ComponentProps<typeof ChatPane> | null }));
vi.mock('../../src/components/ChatPane', () => ({ ChatPane: (props: ComponentProps<typeof ChatPane>) => { captured.pane = props; return <div data-testid="chat">{props.messages.map((row) => <p key={row.id}>{row.content}</p>)}</div>; } }));
vi.mock('../../src/components/AvatarMenu', () => ({ AvatarMenu: () => null }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key, useI18n: () => ({ locale: 'en' }) }));
vi.mock('../../src/providers/daemon', () => ({ streamViaDaemon: vi.fn(), reattachDaemonRun: vi.fn() }));
vi.mock('../../src/state/standalone-conversations', () => ({
  getStandaloneConversation: vi.fn(), listStandaloneMessages: vi.fn(), listStandaloneFiles: vi.fn(),
  listStandaloneActiveRuns: vi.fn(), notifyStandaloneConversationsChanged: vi.fn(),
  deleteStandaloneConversation: vi.fn(), renameStandaloneConversation: vi.fn(), updateStandaloneConversation: vi.fn(),
  uploadStandaloneFiles: vi.fn(), standaloneFileUrl: vi.fn(() => '/raw'),
  getStandaloneFilePreviewScope: vi.fn(), standaloneFilePreviewUrl: vi.fn((base, path) => base + path),
}));
const row = (id = 'standalone') => ({ id, projectId: null, title: id, createdAt: 1, updatedAt: 2 } as const);
const props = { conversationId: 'standalone', workspaceContext: null, config: { mode: 'agent', agentId: 'claude' }, agents: [], daemonLive: true,
  onModeChange: vi.fn(), onAgentChange: vi.fn(), onAgentModelChange: vi.fn(), onRefreshAgents: vi.fn(), onOpenSettings: vi.fn(),
} as unknown as ComponentProps<typeof StandaloneConversationView>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function mount() { const view = render(<StandaloneConversationView {...props} />); await act(async () => {}); return view; }
beforeEach(() => {
  vi.mocked(storage.getStandaloneConversation).mockResolvedValue(row());
  vi.mocked(storage.listStandaloneMessages).mockResolvedValue([]);
  vi.mocked(storage.listStandaloneFiles).mockResolvedValue([]);
  vi.mocked(storage.listStandaloneActiveRuns).mockResolvedValue([]);
  vi.mocked(storage.getStandaloneFilePreviewScope).mockResolvedValue({ baseUrl: '/preview/token/', expiresAt: Date.now() + 60_000 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); captured.pane = null; });
describe('standalone conversation host', () => {
  it('sends without a project, waits for persisted history before allowing the next turn, and continues it', async () => {
    let first!: Parameters<typeof streamViaDaemon>[0]; const stream = deferred<void>();
    vi.mocked(streamViaDaemon).mockImplementation((options) => { first = options; options.onRunCreated?.('run-1'); return stream.promise; });
    await mount();
    await act(async () => { await captured.pane!.onSend('hello', [], []); });
    expect(first.projectId).toBeNull(); expect(first.conversationId).toBe('standalone');
    expect(captured.pane!.streaming).toBe(true);
    const persisted = deferred<Awaited<ReturnType<typeof storage.listStandaloneMessages>>>();
    vi.mocked(storage.listStandaloneMessages).mockReturnValueOnce(persisted.promise);
    await act(async () => { first.handlers.onDelta('answer'); first.handlers.onDone('answer'); });
    expect(captured.pane!.streaming).toBe(true);
    expect(await captured.pane!.onSend('too early', [], [])).toBe('restore-draft');
    await act(async () => { persisted.resolve([{ id: 'u1', role: 'user', content: 'hello' }, { id: 'a1', role: 'assistant', content: 'answer' }]); stream.resolve(); });
    expect(captured.pane!.streaming).toBe(false);
    vi.mocked(streamViaDaemon).mockImplementation(async (options) => { options.onRunCreated?.('run-2'); });
    await act(async () => { await captured.pane!.onSend('continue', [], []); });
    expect(vi.mocked(streamViaDaemon).mock.calls[1]![0].history.map((message) => message.content)).toEqual(['hello', 'answer', 'continue']);
  });
  it('restores rejected or cancelled-before-creation drafts and removes optimistic rows', async () => {
    vi.mocked(streamViaDaemon).mockImplementation(async (options) => { options.handlers.onError(new Error('offline')); });
    await mount();
    await act(async () => { expect(await captured.pane!.onSend('keep me', [], [])).toBe('restore-draft'); });
    expect(captured.pane!.messages).toEqual([]); expect(captured.pane!.error).toBe('offline');
    vi.mocked(streamViaDaemon).mockResolvedValue();
    await act(async () => { expect(await captured.pane!.onSend('cancelled', [], [])).toBe('restore-draft'); });
    expect(captured.pane!.streaming).toBe(false); expect(captured.pane!.messages).toEqual([]);
  });
  it('reattaches an existing run and stops it without a project', async () => {
    vi.mocked(storage.listStandaloneActiveRuns).mockResolvedValue([{ id: 'running', assistantMessageId: 'a', status: 'running', agentId: 'claude' }] as never);
    vi.mocked(reattachDaemonRun).mockReturnValue(new Promise(() => {}));
    const view = await mount();
    const request = vi.mocked(reattachDaemonRun).mock.calls[0]![0];
    expect(request.projectId).toBeNull(); expect(request.conversationId).toBe('standalone');
    expect(captured.pane!.streaming).toBe(true);
    act(() => captured.pane!.onStop()); expect(request.cancelSignal!.aborted).toBe(true);
    view.unmount(); expect(request.signal.aborted).toBe(true);
  });
  it.each([null, 'event-4'])('restores an active partial transcript without duplicating or dropping its prefix (cursor %s)', async (cursor) => {
    vi.mocked(storage.listStandaloneMessages).mockResolvedValue([{ id: 'a', role: 'assistant', content: 'prefix', ...(cursor ? { lastRunEventId: cursor } : {}) }]);
    vi.mocked(storage.listStandaloneActiveRuns).mockResolvedValue([{ id: 'running', assistantMessageId: 'a', status: 'running', agentId: 'claude' }] as never);
    vi.mocked(reattachDaemonRun).mockReturnValue(new Promise(() => {}));
    await mount();
    const request = vi.mocked(reattachDaemonRun).mock.calls[0]![0];
    const refreshed = deferred<Awaited<ReturnType<typeof storage.listStandaloneMessages>>>();
    vi.mocked(storage.listStandaloneMessages).mockReturnValueOnce(refreshed.promise);
    await act(async () => { request.handlers.onDelta(cursor ? '-new' : 'prefix-new'); });
    expect(captured.pane!.messages[0]!.content).toBe('prefix-new');
    await act(async () => { request.handlers.onDone(cursor ? '-new' : 'prefix-new'); });
    expect(captured.pane!.messages[0]!.content).toBe('prefix-new');
    await act(async () => { refreshed.resolve([{ id: 'a', role: 'assistant', content: 'prefix-new' }]); });
    expect(captured.pane!.streaming).toBe(false);
  });
  it('discards old conversation loads and late run events after switching', async () => {
    const pending = deferred<Awaited<ReturnType<typeof storage.listStandaloneMessages>>>();
    vi.mocked(storage.listStandaloneMessages).mockReturnValueOnce(pending.promise);
    const view = render(<StandaloneConversationView {...props} />);
    view.rerender(<StandaloneConversationView {...props} conversationId="new" />);
    await act(async () => { pending.resolve([{ id: 'old', role: 'user', content: 'private-old' }]); });
    expect(screen.queryByText('private-old')).toBeNull();
    expect(captured.pane!.activeConversationId).toBe('new');
  });
  it('uploads through standalone storage and previews the selected file', async () => {
    vi.mocked(storage.uploadStandaloneFiles).mockResolvedValue({ uploaded: [{ path: 'image.png', name: 'image.png', kind: 'image' }], failed: [] });
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    await mount();
    await act(async () => { await captured.pane!.onUploadFiles!([file]); });
    expect(storage.uploadStandaloneFiles).toHaveBeenCalledWith('standalone', [file], null);
    expect(await captured.pane!.onEnsureProject()).toBeNull();
    await act(async () => captured.pane!.onRequestOpenFile!('image.png'));
    expect(storage.getStandaloneFilePreviewScope).toHaveBeenCalledWith('standalone', null, expect.any(AbortSignal));
    expect(screen.getByTitle('image.png').getAttribute('src')).toBe('/preview/token/image.png');
    expect(screen.getByTitle('image.png').getAttribute('sandbox')).toBe('allow-scripts');
  });
  it('shows preview loading and errors, retries, and obtains a fresh scope on reopening', async () => {
    const scope = deferred<Awaited<ReturnType<typeof storage.getStandaloneFilePreviewScope>>>();
    vi.mocked(storage.getStandaloneFilePreviewScope).mockReturnValueOnce(scope.promise);
    await mount(); act(() => captured.pane!.onRequestOpenFile!('index.html'));
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    await act(async () => { scope.resolve({ baseUrl: '/preview/first/', expiresAt: Date.now() + 60_000 }); });
    expect(screen.getByTitle('index.html').getAttribute('src')).toBe('/preview/first/index.html');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'common.close' })));
    vi.mocked(storage.getStandaloneFilePreviewScope).mockRejectedValueOnce(new Error('Preview unavailable'));
    await act(async () => captured.pane!.onRequestOpenFile!('index.html'));
    expect(screen.getByRole('alert').textContent).toContain('Preview unavailable');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'preview.retry' })));
    expect(screen.getByTitle('index.html').getAttribute('src')).toBe('/preview/token/index.html');
    expect(storage.getStandaloneFilePreviewScope).toHaveBeenCalledTimes(3);
  });
  it('refreshes an expired preview capability without relaxing iframe isolation', async () => {
    await mount(); vi.useFakeTimers();
    vi.mocked(storage.getStandaloneFilePreviewScope)
      .mockResolvedValueOnce({ baseUrl: '/preview/expiring/', expiresAt: Date.now() + 2000 })
      .mockResolvedValueOnce({ baseUrl: '/preview/refreshed/', expiresAt: Date.now() + 60_000 });
    await act(async () => captured.pane!.onRequestOpenFile!('index.html'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(storage.getStandaloneFilePreviewScope).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle('index.html').getAttribute('src')).toBe('/preview/refreshed/index.html');
    expect(screen.getByTitle('index.html').getAttribute('sandbox')).toBe('allow-scripts');
  });
  it('ignores preview authorization arriving after the conversation changed', async () => {
    const scope = deferred<Awaited<ReturnType<typeof storage.getStandaloneFilePreviewScope>>>();
    vi.mocked(storage.getStandaloneFilePreviewScope).mockReturnValueOnce(scope.promise);
    const view = await mount(); act(() => captured.pane!.onRequestOpenFile!('private.html'));
    const signal = vi.mocked(storage.getStandaloneFilePreviewScope).mock.calls[0]![2]!;
    view.rerender(<StandaloneConversationView {...props} conversationId="other" />);
    await act(async () => { scope.resolve({ baseUrl: '/preview/private/', expiresAt: Date.now() + 60_000 }); });
    expect(signal.aborted).toBe(true); expect(screen.queryByTitle('private.html')).toBeNull();
  });
  it('renames and confirms deletion through the standalone endpoints', async () => {
    vi.mocked(storage.renameStandaloneConversation).mockResolvedValue({ ...row(), title: 'renamed' });
    vi.mocked(storage.deleteStandaloneConversation).mockResolvedValue();
    const onDeleted = vi.fn();
    render(<StandaloneConversationView {...props} onDeleted={onDeleted} />); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'common.rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'common.rename' }), { target: { value: 'renamed' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.save' })); });
    expect(storage.renameStandaloneConversation).toHaveBeenCalledWith('standalone', 'renamed', null);
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(storage.deleteStandaloneConversation).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' }).at(-1)!); });
    expect(storage.deleteStandaloneConversation).toHaveBeenCalledWith('standalone', null); expect(onDeleted).toHaveBeenCalledOnce();
  });
});
