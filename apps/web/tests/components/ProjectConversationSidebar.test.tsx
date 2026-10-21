// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Project, WorkspaceCollabContext } from '@open-design/contracts';
import { ProjectConversationSidebar, type ProjectConversationSidebarProps } from '../../src/components/ProjectConversationSidebar';
import { advanceWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';
import { listConversations } from '../../src/state/projects';
import { useProjectRunStatuses } from '../../src/hooks/useProjectRunStatuses';

vi.mock('../../src/hooks/useProjectRunStatuses', () => ({ useProjectRunStatuses: vi.fn(() => new Map()), acknowledgeProjectCompletion: vi.fn() }));
vi.mock('../../src/state/projects', () => ({ listConversations: vi.fn() }));
vi.mock('../../src/i18n', () => ({ useT: () => (key: string, vars?: Record<string, string>) => vars?.name ? `${key} ${vars.name}` : key }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

const project: Project = { id: 'p1', name: 'Product website', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 2 };
const conversation = (id: string, title: string | null): Conversation => ({ id, projectId: 'p1', title, createdAt: 1, updatedAt: 2 });
function props(overrides: Partial<ProjectConversationSidebarProps> = {}): ProjectConversationSidebarProps {
  return { projects: [project], workspaceContext: null, onOpenProject: vi.fn(), onOpenConversation: vi.fn(), onNewProject: vi.fn(), onNewConversation: vi.fn(), onBrowseProjects: vi.fn(), ...overrides };
}
function expand() { fireEvent.click(screen.getByRole('button', { name: 'homeSidebar.expandProject Product website' })); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function workspace(member = 'one'): WorkspaceCollabContext {
  return { workspaceId: 'workspace', workspaceMemberId: member, workspaceType: 'team', role: 'member', lifecycleState: 'active', memberStatus: 'active', permissions: { canShareProjects: true, canWriteSyncedFiles: true } } as WorkspaceCollabContext;
}

describe('ProjectConversationSidebar', () => {
  it('shows only the recovery notice when catalogue authority fails, hiding stale rows and false loading or empty states', async () => {
    const response = deferred<Conversation[]>();
    vi.mocked(listConversations).mockReturnValueOnce(response.promise);
    const callbacks = props({ conversationsSlot: <p>Independent history</p>, headerSlot: <p>Recover account</p> });
    const view = render(<ProjectConversationSidebar {...callbacks} />);
    expand();
    view.rerender(<ProjectConversationSidebar {...callbacks} catalogUnavailable catalogLoading />);
    expect(screen.getByText('Recover account')).toBeTruthy();
    expect(screen.queryByText('Product website')).toBeNull();
    expect(screen.queryByText('Independent history')).toBeNull();
    expect(screen.queryByText('common.loading')).toBeNull();
    expect(screen.queryByText('recentProjects.empty')).toBeNull();
    await act(async () => response.resolve([conversation('private', 'Stale response')]));
    expect(screen.queryByText('Stale response')).toBeNull();
    view.rerender(<ProjectConversationSidebar {...callbacks} projects={[]} catalogUnavailable />);
    expect(screen.queryByText('recentProjects.empty')).toBeNull();
    view.rerender(<ProjectConversationSidebar {...callbacks} projects={[]} />);
    expect(screen.getByText('recentProjects.empty')).toBeTruthy();
    expect(screen.getByText('Independent history')).toBeTruthy();
    expect(listConversations).toHaveBeenCalledTimes(1);
  });
  it('keeps project opening separate from expansion and routes the exact child conversation', async () => {
    const response = deferred<Conversation[]>();
    vi.mocked(listConversations).mockReturnValueOnce(response.promise);
    const callbacks = props({ workspaceContext: workspace() });
    render(<ProjectConversationSidebar {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Product website' }));
    expect(callbacks.onOpenProject).toHaveBeenCalledWith('p1');
    expect(listConversations).not.toHaveBeenCalled();
    expand();
    expect(callbacks.onOpenProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    expect(listConversations).toHaveBeenCalledWith('p1', { workspaceContext: callbacks.workspaceContext, throwOnError: true });
    await act(async () => { response.resolve([conversation('c1', 'Layout'), conversation('c2', 'Mobile adaptation')]); });
    fireEvent.click(screen.getByRole('button', { name: 'Mobile adaptation' }));
    expect(callbacks.onOpenConversation).toHaveBeenCalledWith('p1', 'c2');
    expect(callbacks.onOpenProject).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a failed read from an empty project and can retry', async () => {
    vi.mocked(listConversations).mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce([]);
    render(<ProjectConversationSidebar {...props()} />);
    await act(async () => { expand(); });
    expect(screen.getByRole('alert').textContent).toBe('homeSidebar.conversationsLoadFailed');
    expect(screen.queryByText('homeSidebar.noConversations')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'homeSidebar.retry' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('homeSidebar.noConversations')).toBeTruthy();
    expect(listConversations).toHaveBeenCalledTimes(2);
  });
  it('discards delayed reads after authority changes even when the project id is unchanged', async () => {
    const oldResponse = deferred<Conversation[]>();
    vi.mocked(listConversations).mockReturnValueOnce(oldResponse.promise).mockResolvedValueOnce([conversation('new', 'Current authority')]);
    const callbacks = props({ workspaceContext: workspace('old') });
    const view = render(<ProjectConversationSidebar {...callbacks} />);
    expand();
    view.rerender(<ProjectConversationSidebar {...callbacks} workspaceContext={workspace('new')} />);
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => { expand(); });
    await act(async () => { oldResponse.resolve([conversation('old', 'Previous authority')]); });
    expect(screen.getByRole('button', { name: 'Current authority' })).toBeTruthy();
    expect(screen.queryByText('Previous authority')).toBeNull();
  });
  it('invalidates loaded children on a same-workspace account boundary', async () => {
    vi.mocked(listConversations).mockResolvedValue([conversation('c1', 'Private conversation')]);
    const callbacks = props({ workspaceContext: workspace() });
    const view = render(<ProjectConversationSidebar {...callbacks} />);
    await act(async () => { expand(); });
    expect(screen.getByText('Private conversation')).toBeTruthy();
    advanceWorkspaceAccountGeneration('sidebar-account-test');
    view.rerender(<ProjectConversationSidebar {...callbacks} />);
    expect(screen.queryByText('Private conversation')).toBeNull();
    expect(screen.getByRole('button', { name: 'homeSidebar.expandProject Product website' }).getAttribute('aria-expanded')).toBe('false');
  });
  it('does not turn expansion into selection and preserves untitled conversation labels', async () => {
    vi.mocked(listConversations).mockResolvedValue([conversation('c1', null), conversation('c2', 'Selected conversation')]);
    render(<ProjectConversationSidebar {...props({ activeProjectId: 'p1', activeConversationId: 'c2' })} />);
    await act(async () => { expand(); });
    expect(screen.getByRole('button', { name: 'Product website' }).hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('button', { name: 'chat.untitledConversation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Selected conversation' }).getAttribute('aria-current')).toBe('page');
  });
  it('retains the existing rename and duplicate row menu', async () => {
    const callbacks = props({ onRenameRecentProject: vi.fn(), onDuplicateRecentProject: vi.fn() });
    render(<ProjectConversationSidebar {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'designs.menuRename' }));
    const nameInput = screen.getByRole('textbox', { name: 'designs.menuRename' });
    fireEvent.change(nameInput, { target: { value: 'Renamed project' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(callbacks.onRenameRecentProject).toHaveBeenCalledWith('p1', 'Renamed project');
    fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'designs.menuDuplicate' })); });
    expect(callbacks.onDuplicateRecentProject).toHaveBeenCalledWith('p1');
  });
  it('keeps foreign shared project mutations disabled', () => {
    const callbacks = props({
      workspaceContext: workspace('reader'),
      onRenameRecentProject: vi.fn(), onDuplicateRecentProject: vi.fn(), onDeleteRecentProject: vi.fn(),
      isSharedRecentProject: () => true, recentProjectOwnerMemberIds: new Map([['p1', 'owner']]),
    });
    render(<ProjectConversationSidebar {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'designs.menuMore' }));
    for (const name of ['designs.menuRename', 'designs.menuDuplicate', 'designs.menuDelete']) {
      const action = screen.getByRole('menuitem', { name });
      expect(action.hasAttribute('disabled')).toBe(true);
      fireEvent.click(action);
    }
    expect(callbacks.onDeleteRecentProject).not.toHaveBeenCalled();
    expect(callbacks.onDuplicateRecentProject).not.toHaveBeenCalled();
    expect(callbacks.onRenameRecentProject).not.toHaveBeenCalled();
  });
  it('subscribes only to the recent head then the visible project rows, and stops when hidden', () => {
    let notify!: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const projects = Array.from({ length: 15 }, (_, index) => ({ ...project, id: `p${index}`, name: `Project ${index}`, updatedAt: index }));
    const callbacks = props({ projects });
    const view = render(<ProjectConversationSidebar {...callbacks} />);
    expect(vi.mocked(useProjectRunStatuses).mock.lastCall?.[0]).toEqual(Array.from({ length: 11 }, (_, index) => `p${14 - index}`));
    expect(observe).toHaveBeenCalledTimes(15);
    const row = view.container.querySelector('[data-project-id="p2"]')!;
    act(() => { notify([{ target: row, isIntersecting: true }]); });
    expect(vi.mocked(useProjectRunStatuses).mock.lastCall?.[0]).toEqual(['p2']);
    act(() => { notify([{ target: row, isIntersecting: false }]); });
    expect(vi.mocked(useProjectRunStatuses).mock.lastCall?.[0]).toEqual([]);
    view.rerender(<ProjectConversationSidebar {...callbacks} enabled={false} />);
    expect(vi.mocked(useProjectRunStatuses).mock.lastCall?.[1]?.enabled).toBe(false);
    expect(disconnect).toHaveBeenCalled();
  });
  it('allows an external status owner without starting another subscription', () => {
    render(<ProjectConversationSidebar {...props({ projectRunStatuses: new Map() })} />);
    expect(vi.mocked(useProjectRunStatuses).mock.lastCall?.[1]?.enabled).toBe(false);
  });
  it('defers conversation reads while the sidebar is hidden', async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    const callbacks = props();
    const view = render(<ProjectConversationSidebar {...callbacks} enabled={false} />);
    expand();
    expect(listConversations).not.toHaveBeenCalled();
    await act(async () => { view.rerender(<ProjectConversationSidebar {...callbacks} enabled />); });
    expect(listConversations).toHaveBeenCalledTimes(1);
  });
  it('exposes real actions, respects disabled creation, and leaves conversation content to its owner', () => {
    const callbacks = props({ projects: [], newConversationDisabled: true, conversationsSlot: <section aria-label="Recent conversations">A supplied catalogue</section> });
    render(<ProjectConversationSidebar {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'entry.navNewProject' }));
    fireEvent.click(screen.getByRole('button', { name: 'homeSidebar.newConversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'entry.navDrafts' }));
    expect(callbacks.onNewProject).toHaveBeenCalledTimes(1);
    expect(callbacks.onNewConversation).not.toHaveBeenCalled();
    expect(callbacks.onBrowseProjects).toHaveBeenCalledTimes(1);
    expect(screen.getByText('recentProjects.empty')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Recent conversations' }).textContent).toBe('A supplied catalogue');
    expect(listConversations).not.toHaveBeenCalled();
  });
});
