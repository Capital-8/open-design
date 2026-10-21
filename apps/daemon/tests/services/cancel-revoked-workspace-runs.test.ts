import { describe, expect, it, vi } from 'vitest';
import {
  createRevokedWorkspaceRunCancellation,
  workspaceRunActorKey,
} from '../../src/services/cancel-revoked-workspace-runs.js';

function actor(userId = 'member-a', profile = 'local', apiUrl = 'http://api.local') {
  return workspaceRunActorKey({
    login: { loggedIn: true, profile, user: { id: userId } },
    control: { profile, apiUrl, user: { id: userId } },
    credentialOverrides: false,
  })!;
}

interface Run {
  id: string;
  agentId: string;
  status: string;
  cancelRequested?: boolean;
  workspaceScope: { workspaceId: string; workspaceMemberId: string };
}
function run(id: string, workspaceId = 'go'): Run {
  return { id, agentId: 'amr', status: 'running', workspaceScope: { workspaceId, workspaceMemberId: 'project-creator' } };
}
function harness(runs: Run[]) {
  const cancel = vi.fn(async (r: Run, _origin: 'unknown') => {
    r.cancelRequested = true;
    r.status = 'canceled';
  });
  const onError = vi.fn();
  const coordinator = createRevokedWorkspaceRunCancellation({
    listRuns: () => runs,
    isTerminal: (status) => ['canceled', 'succeeded', 'failed'].includes(status),
    cancel,
    onError,
  });
  return { coordinator, cancel, onError };
}

describe('authenticated workspace run actor', () => {
  it('keeps the same account across refresh, key rotation and config rewrites', () => {
    const before = {
      login: { loggedIn: true, profile: 'local', user: { id: 'member-a' }, credentialRevision: 'old-key-and-mtime' },
      control: { profile: 'local', apiUrl: 'http://api.local', user: { id: 'member-a' }, configMtimeMs: 10, controlKey: 'old-test-key' },
      credentialOverrides: false,
    };
    const after = {
      ...before,
      login: { ...before.login, credentialRevision: 'rotated-key-and-mtime' },
      control: { ...before.control, configMtimeMs: 20, controlKey: 'new-test-key' },
    };
    expect(workspaceRunActorKey(after)).toBe(workspaceRunActorKey(before));
  });

  it('separates users, API deployments and profiles', () => {
    expect(actor('member-b')).not.toBe(actor());
    expect(actor('member-a', 'test')).not.toBe(actor());
    expect(actor('member-a', 'local', 'http://another-api.local')).not.toBe(actor());
  });

  it('does not invent an actor for unknown runtime credentials or mixed users', () => {
    const evidence = {
      login: { loggedIn: true, profile: 'local', user: { id: 'member-a' } },
      control: { profile: 'local', apiUrl: 'http://api.local', user: { id: 'member-b' } },
      credentialOverrides: false,
    };
    expect(workspaceRunActorKey(evidence)).toBeNull();
    expect(workspaceRunActorKey({
      ...evidence,
      control: { ...evidence.control, user: { id: 'member-a' } },
      credentialOverrides: true,
    })).toBeNull();
    expect(workspaceRunActorKey({ ...evidence, login: { ...evidence.login, user: null } })).toBeNull();
  });
});

describe('revoked workspace host runs', () => {
  it('cancels only the exact workspace and authenticated actor, never the creator or ambient selection', async () => {
    const matching = run('matching');
    const personal = run('personal', 'personal');
    const otherActor = run('other-actor');
    const terminal = { ...run('terminal'), status: 'succeeded' };
    const otherAgent = { ...run('other-agent'), agentId: 'codex' };
    const h = harness([matching, personal, otherActor, terminal, otherAgent]);
    for (const r of [matching, personal, otherActor, terminal, otherAgent]) {
      h.coordinator.begin(r);
      h.coordinator.pin(r, r === otherActor ? actor('member-b') : actor());
    }

    await h.coordinator.revoke('go', actor());

    expect(h.cancel).toHaveBeenCalledExactlyOnceWith(matching, 'unknown');
    expect(matching.status).toBe('canceled');
    expect(personal.status).toBe('running');
    expect(otherActor.status).toBe('running');
    expect(otherAgent.status).toBe('running');
  });

  it('still stops an older run after the same account credentials refresh', async () => {
    const r = run('before-refresh');
    const h = harness([r]);
    h.coordinator.begin(r);
    h.coordinator.pin(r, actor());
    await h.coordinator.revoke('go', actor('member-a', 'local', 'http://api.local/'));
    expect(r.status).toBe('canceled');
  });

  it('fences a verified revocation received before setup can pin the actual child actor', async () => {
    const r = run('setting-up');
    const h = harness([r]);
    h.coordinator.begin(r);
    await h.coordinator.revoke('go', actor());
    expect(h.cancel).not.toHaveBeenCalled();

    expect(h.coordinator.pin(r, actor())).toBe(false);
    expect(r.status).toBe('canceled');
  });

  it('does not consume a different actor or space revocation while setup is awaiting', async () => {
    const r = run('setting-up');
    const h = harness([r]);
    h.coordinator.begin(r);
    await h.coordinator.revoke('go', actor('member-b'));
    await h.coordinator.revoke('personal', actor());
    expect(h.coordinator.pin(r, actor())).toBe(true);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('does not re-pin an existing run to another account on retry', () => {
    const r = run('retry');
    const h = harness([r]);
    h.coordinator.begin(r);
    expect(h.coordinator.pin(r, actor())).toBe(true);
    h.coordinator.begin(r);
    expect(h.coordinator.pin(r, actor('member-b'))).toBe(false);
    expect(r.status).toBe('canceled');
  });

  it('keeps setup fenced while physical cancellation is still awaiting child exit', async () => {
    const r = run('child-pending');
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
    const cancel = vi.fn(async (active: Run) => {
      active.cancelRequested = true;
      await exited;
      active.status = 'canceled';
    });
    const coordinator = createRevokedWorkspaceRunCancellation({
      listRuns: () => [r], isTerminal: (status) => status === 'canceled', cancel,
    });
    coordinator.begin(r);
    coordinator.pin(r, actor());
    const canceled = coordinator.revoke('go', actor());
    const duplicate = coordinator.revoke('go', actor());
    expect(r.cancelRequested).toBe(true);
    expect(coordinator.pin(r, actor())).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    resolveExit();
    await Promise.all([canceled, duplicate]);
    expect(coordinator.pin(r, actor())).toBe(false);
  });

  it('leaves an unproven actor alone and permits a newly authorized future run', async () => {
    const old = run('unproven');
    const fresh = run('new-after-rejoin');
    const h = harness([old, fresh]);
    h.coordinator.begin(old);
    h.coordinator.pin(old, null);
    await h.coordinator.revoke('go', actor());
    h.coordinator.begin(fresh);
    expect(h.coordinator.pin(fresh, actor())).toBe(true);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it('continues stopping sibling runs if one cancellation fails', async () => {
    const runs = [run('first'), run('second')];
    const h = harness(runs);
    h.cancel.mockRejectedValueOnce(new Error('child teardown unavailable'));
    for (const r of runs) { h.coordinator.begin(r); h.coordinator.pin(r, actor()); }
    await h.coordinator.revoke('go', actor());
    expect(h.cancel).toHaveBeenCalledTimes(2);
    expect(h.onError).toHaveBeenCalledWith(runs[0]);
    expect(runs[1]!.status).toBe('canceled');
  });
});
