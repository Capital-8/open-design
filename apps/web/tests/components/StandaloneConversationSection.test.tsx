// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StandaloneConversation, WorkspaceCollabContext } from '@open-design/contracts';
import { StandaloneConversationSection, useStandaloneConversationCatalog } from '../../src/components/StandaloneConversationSection';
import { createStandaloneConversation, listStandaloneConversations } from '../../src/state/standalone-conversations';
import { navigate } from '../../src/router';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../src/router', () => ({ navigate: vi.fn() }));
vi.mock('../../src/state/standalone-conversations', () => ({
  listStandaloneConversations: vi.fn(), createStandaloneConversation: vi.fn(),
  STANDALONE_CONVERSATIONS_CHANGED_EVENT: 'standalone-changed',
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const row = (id: string): StandaloneConversation => ({ id, projectId: null, title: id, createdAt: 1, updatedAt: 2 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function Harness({ context = null, enabled = true }: { context?: WorkspaceCollabContext | null; enabled?: boolean }) {
  const catalog = useStandaloneConversationCatalog(context, enabled);
  return <><button onClick={() => void catalog.create()} disabled={catalog.creating}>Create</button><StandaloneConversationSection catalog={catalog} /></>;
}
describe('independent conversation catalog', () => {
  it('shows the actual latest run state beside its conversation', async () => {
    vi.mocked(listStandaloneConversations).mockResolvedValue([{ ...row('work'), runStatus: 'running' }]);
    render(<Harness />);
    expect(await screen.findByText('designs.status.running')).toBeTruthy();
  });
  it('hides existing rows and prevents creation while authority is unresolved', async () => {
    vi.mocked(listStandaloneConversations).mockResolvedValue([row('private-old')]);
    const view = render(<Harness />);
    await screen.findByText('private-old');
    view.rerender(<Harness enabled={false} />);
    expect(screen.queryByText('private-old')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByText('Create'));
    expect(createStandaloneConversation).not.toHaveBeenCalled();
  });
  it('creates once without a project and opens the returned conversation', async () => {
    vi.mocked(listStandaloneConversations).mockResolvedValue([]);
    const pending = deferred<StandaloneConversation>();
    vi.mocked(createStandaloneConversation).mockReturnValue(pending.promise);
    render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Create'));
    fireEvent.click(screen.getByText('Create'));
    expect(createStandaloneConversation).toHaveBeenCalledExactlyOnceWith({}, null);
    await act(async () => { pending.resolve(row('standalone')); });
    expect(navigate).toHaveBeenCalledWith({ kind: 'standalone-conversation', conversationId: 'standalone' });
  });
  it('opens the actual independent id and refreshes after a change', async () => {
    vi.mocked(listStandaloneConversations).mockResolvedValueOnce([row('first')]).mockResolvedValueOnce([row('second')]);
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'first' }));
    expect(navigate).toHaveBeenCalledWith({ kind: 'standalone-conversation', conversationId: 'first' });
    await act(async () => { window.dispatchEvent(new Event('standalone-changed')); });
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });
  it('distinguishes read errors from empty and retries', async () => {
    vi.mocked(listStandaloneConversations).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([]);
    render(<Harness />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('homeSidebar.noConversations')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('homeSidebar.retry')); });
    expect(screen.getByText('homeSidebar.noConversations')).toBeTruthy();
  });
  it('does not reveal a delayed result from another workspace', async () => {
    const old = deferred<StandaloneConversation[]>();
    vi.mocked(listStandaloneConversations).mockReturnValueOnce(old.promise).mockResolvedValueOnce([row('current')]);
    const view = render(<Harness />);
    view.rerender(<Harness context={{ workspaceId: 'new', workspaceMemberId: 'member' } as WorkspaceCollabContext} />);
    await act(async () => { old.resolve([row('private-old')]); });
    expect(screen.queryByText('private-old')).toBeNull();
    expect(screen.getByText('current')).toBeTruthy();
  });
  it('does not navigate after leaving while creation is pending', async () => {
    vi.mocked(listStandaloneConversations).mockResolvedValue([]);
    const pending = deferred<StandaloneConversation>();
    vi.mocked(createStandaloneConversation).mockReturnValue(pending.promise);
    const view = render(<Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Create'));
    view.unmount();
    await act(async () => { pending.resolve(row('late')); });
    expect(navigate).not.toHaveBeenCalled();
  });
});
