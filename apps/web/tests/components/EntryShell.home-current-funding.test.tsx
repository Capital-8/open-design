// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildWorkspacePermissions, buildWorkspaceSeatSummary, type WorkspaceCollabContext } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryShellWithGateHost } from '../helpers/entry-shell-gate-host';
import { workspaceDirectoryFixture } from '../helpers/workspace-context';
import { setHomeHeroPrompt } from '../helpers/home-hero-lexical';
import { I18nProvider } from '../../src/i18n';
import { notifyWorkspaceContextRefresh, resetTeamProjectsCache, resetWorkspaceBillingCache, resetWorkspaceContextCache } from '../../src/collab/useWorkspaceContext';
import { advanceWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';
import { checkAmrBalanceGate } from '../../src/runtime/amr-balance-gate';
import { invalidateAmrFundingFeedback } from '../../src/runtime/amr-funding-feedback';
import type { AgentInfo, AppConfig } from '../../src/types';

vi.mock('../../src/runtime/amr-balance-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/runtime/amr-balance-gate')>()), checkAmrBalanceGate: vi.fn(),
}));
const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function response(value: unknown) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function context(id: string): WorkspaceCollabContext {
  return { workspaceId: id, workspaceMemberId: `${id}-owner`, workspaceType: 'team', role: 'owner', memberStatus: 'active', lifecycleState: 'active', billingState: 'active', planId: 'team_go', providerMode: 'platform_credits', seatSummary: buildWorkspaceSeatSummary({ seatLimit: 5, usedSeats: 1 }), permissions: buildWorkspacePermissions({ role: 'owner', lifecycleState: 'active' }) };
}
const agent: AgentInfo = { id: 'amr', name: 'AMR', bin: 'amr', available: true, models: [{ id: 'glm-5', label: 'GLM 5' }] };
const config: AppConfig = { mode: 'daemon', agentId: 'amr', agentModels: { amr: { model: 'glm-5' } }, apiProtocol: 'anthropic', apiProtocolConfigs: {}, apiKey: '', baseUrl: '', model: '', skillId: null, designSystemId: null, theme: 'system' };
function preflight(ctx: WorkspaceCollabContext, fundingCheck: 'available' | 'insufficient' | 'unknown', balanceUsd: string) {
  return { schemaVersion: 1, workspaceId: ctx.workspaceId, workspaceMemberId: ctx.workspaceMemberId, modelId: 'glm-5', generatedAt: new Date().toISOString(), balanceUsd, modelCovered: true, fundingCheck, funding: balanceUsd === '0' && fundingCheck === 'available' ? 'coding_plan' : 'gateway', codingPlan: { workspaceId: ctx.workspaceId, generatedAt: new Date().toISOString(), eligible: true, tier: 'go', windows: [{ policyId: 'window', durationSeconds: 18000, resetMode: 'anchored_recurring', usedCredits: fundingCheck === 'available' ? '0' : '100', limitCredits: '100', remainingCredits: fundingCheck === 'available' ? '100' : '0', windowStart: new Date().toISOString(), resetsAt: new Date(Date.now() + 18000_000).toISOString() }] } };
}

beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as typeof ResizeObserver;
  window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, '', '/');
  resetWorkspaceContextCache(); resetWorkspaceBillingCache(); resetTeamProjectsCache(); invalidateAmrFundingFeedback();
  vi.mocked(checkAmrBalanceGate).mockResolvedValue({ kind: 'allow' });
});
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; globalThis.ResizeObserver = originalResizeObserver; vi.mocked(checkAmrBalanceGate).mockReset(); resetWorkspaceContextCache(); resetWorkspaceBillingCache(); resetTeamProjectsCache(); invalidateAmrFundingFeedback(); });

describe('D0 gen53 / client VIEW-015 and RUN-003 current Home funding', () => {
  it.each([
    { decision: 'insufficient', mutation: 'none' },
    { decision: 'unknown', mutation: 'none' },
    { decision: 'available', mutation: 'none' },
    { decision: 'available', mutation: 'prompt' },
    { decision: 'available', mutation: 'file' },
    { decision: 'available', mutation: 'workspace' },
    { decision: 'available', mutation: 'account' },
    { decision: 'insufficient', mutation: 'late-display' },
  ] as const)('A 100 USD → loading B zero cash ($decision, $mutation): current funds precede project handoff', async ({ decision, mutation }) => {
    const a = context(`gen53-A-${decision}`), b = context(`gen53-B-${decision}`);
    let current = a, aReads = 0, sent = false;
    const firstAction = deferred<'funding' | 'begin'>();
    const bFunding: Array<(r: Response) => void> = [];
    const displayB = deferred<Response>();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/workspace/directory')) return response(workspaceDirectoryFixture([a, b]));
      if (url.endsWith('/api/workspace/context')) return response({ context: current });
      if (url.includes('/billing/preflight?')) {
        if (url.includes(encodeURIComponent(a.workspaceId))) { aReads++; return response({ preflight: preflight(a, 'available', '100') }); }
        if (sent) firstAction.resolve('funding');
        return new Promise<Response>((resolve) => bFunding.push(resolve));
      }
      if (url.includes('/billing/request-concurrency?')) return response({});
      if (url.includes('/api/workspace/billing?')) {
        if (current === b) return displayB.promise;
        return response({ summary: null, workspaceBalance: { workspaceId: a.workspaceId, workspaceMemberId: a.workspaceMemberId, balanceUsd: '100', billingScopeVersion: 2, expiresAt: null, updatedAt: null } });
      }
      if (url.endsWith('/api/workspace/projects/team')) return response({ projects: [] });
      if (url.endsWith('/api/plugins')) return response({ plugins: [] });
      if (url.endsWith('/api/mcp/servers')) return response({ servers: [] });
      return response({ stale: true });
    }) as typeof fetch;
    const begin = vi.fn(() => { if (sent) firstAction.resolve('begin'); return { projectId: 'should-only-exist-after-proof', rollback: vi.fn() }; });
    const create = vi.fn(async (_input: unknown) => true);
    render(<I18nProvider initial="en"><EntryShellWithGateHost skills={[]} designTemplates={[]} designSystems={[]} projects={[]} templates={[]} promptTemplates={[]} defaultDesignSystemId={null} connectors={[]} connectorsLoading={false} config={config} agents={[agent]} daemonLive onModeChange={vi.fn()} onAgentChange={vi.fn()} onAgentModelChange={vi.fn()} onApiProtocolChange={vi.fn()} onApiModelChange={vi.fn()} onConfigPersist={vi.fn()} onRefreshAgents={vi.fn(() => [agent])} onCreateProject={create} onBeginProjectCreation={begin} onCreatePluginShareProject={vi.fn()} onImportClaudeDesign={vi.fn()} onOpenProject={vi.fn()} onOpenLiveArtifact={vi.fn()} onDeleteProject={vi.fn()} onRenameProject={vi.fn()} onChangeDefaultDesignSystem={vi.fn()} onPersistComposioKey={vi.fn()} onOpenSettings={vi.fn()} onCompleteOnboarding={vi.fn()} /></I18nProvider>);
    await waitFor(() => expect(aReads).toBeGreaterThan(0));
    current = b;
    act(() => notifyWorkspaceContextRefresh({ context: b }));
    await waitFor(() => expect(bFunding.length).toBeGreaterThan(0));
    const file = new File(['exact original bytes'], 'home.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('home-hero-file-input'), { target: { files: [file] } });
    setHomeHeroPrompt('Keep the B draft and file at Home');
    await waitFor(() => expect(screen.getByTestId('home-hero-submit')).toBeEnabled());
    sent = true;
    fireEvent.click(screen.getByTestId('home-hero-submit'));
    // Observe the first real boundary, with no sleep: the old implementation
    // invokes App's optimistic handoff before starting a current B funding read.
    expect(await firstAction.promise).toBe('funding');
    expect(begin).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    if (mutation === 'prompt') {
      setHomeHeroPrompt('New draft typed while funding is pending');
      await waitFor(() => expect(screen.getByTestId('home-hero-input')).toHaveTextContent('New draft typed while funding is pending'));
    }
    if (mutation === 'file') {
      fireEvent.change(screen.getByTestId('home-hero-file-input'), { target: { files: [new File(['new bytes'], 'new-file.txt', { type: 'text/plain' })] } });
      await screen.findByText('new-file.txt');
    }
    if (mutation === 'workspace') {
      current = a;
      act(() => notifyWorkspaceContextRefresh({ context: a }));
    }
    if (mutation === 'account') act(() => { advanceWorkspaceAccountGeneration('gen53-account-changed'); });
    if (mutation === 'late-display') {
      await act(async () => { displayB.resolve(response({ summary: null, workspaceBalance: { workspaceId: a.workspaceId, workspaceMemberId: a.workspaceMemberId, balanceUsd: '100', billingScopeVersion: 2, expiresAt: null, updatedAt: null } })); });
    }
    await act(async () => { for (const resolve of bFunding) resolve(response({ preflight: preflight(b, decision, '0') })); });
    if (decision === 'available' && mutation === 'none') {
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(begin).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]?.[0]).toMatchObject({ pendingPrompt: 'Keep the B draft and file at Home', pendingFiles: [file] });
    } else {
      if (decision === 'insufficient') await screen.findByTestId('amr-balance-dialog');
      else await waitFor(() => expect(screen.getByTestId('home-hero-submit')).toBeEnabled());
      expect(begin).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
      expect(screen.getByTestId('home-hero-input')).toHaveTextContent(mutation === 'prompt' ? 'New draft typed while funding is pending' : 'Keep the B draft and file at Home');
      if (mutation === 'file') expect(screen.getByText('new-file.txt')).toBeInTheDocument();
    }
  });
});
