import { describe, expect, it } from 'vitest';
import type { FundingFixture } from '@/playwright/workspace-funding-fixture';
import { assertWorkspaceSwitchProof, type WorkspaceSwitchProof } from '@/playwright/workspace-switch-fixture';

function given() {
  const fixture = { upstream: { amrSha: 'a'.repeat(40) }, actor: { userId: 'actor' }, scopeSwitch: {
    attemptId: '8a03f6be-b9af-4693-a4be-cb1cba277789', spaces: {}, usage: {},
  } } as FundingFixture;
  const proof: WorkspaceSwitchProof = { amrSha: 'a'.repeat(40), actorUserId: 'actor', spaces: {} as WorkspaceSwitchProof['spaces'] };
  for (const alias of ['a', 'b'] as const) {
    fixture.scopeSwitch!.spaces[alias] = { workspaceId: alias, workspaceName: `Actual ${alias}`, ownerMemberId: `${alias}-owner`, runtimeKey: `${alias}-key` };
    fixture.scopeSwitch!.usage[alias] = [
      { kind: 'main', modelId: 'main', tokens: { input: 10 }, expectedCredits: alias === 'a' ? '15000' : '25000' },
      { kind: 'aux', modelId: 'aux', tokens: { input: 2 }, expectedCredits: '2000' },
      { kind: 'aux', modelId: 'aux', tokens: { input: 3 }, expectedCredits: '3000' },
    ];
    proof.spaces[alias] = { workspaceId: alias, workspaceMemberId: `${alias}-owner`, balanceCredits: alias === 'a' ? '100000' : '200000', availableBalanceUsd: alias === 'a' ? '10.0000' : '20.0000' };
  }
  return { fixture, proof };
}

describe('WS-005 original two-space funding Given', () => {
  it('includes every auxiliary amount without assuming one auxiliary invocation', () => {
    const { fixture, proof } = given();
    expect(() => assertWorkspaceSwitchProof(fixture, proof)).not.toThrow();
    fixture.scopeSwitch!.usage.a.pop();
    expect(() => assertWorkspaceSwitchProof(fixture, proof)).toThrow();
  });
  it.each(['source', 'actor', 'member', 'startingFunds', 'duplicateSpace'] as const)('rejects mismatched %s scope', key => {
    const { fixture, proof } = given();
    if (key === 'source') proof.amrSha = 'b'.repeat(40);
    if (key === 'actor') proof.actorUserId = 'other';
    if (key === 'member') proof.spaces.a.workspaceMemberId = 'other';
    if (key === 'startingFunds') proof.spaces.a.balanceCredits = '200000';
    if (key === 'duplicateSpace') fixture.scopeSwitch!.spaces.b.workspaceId = 'a';
    expect(() => assertWorkspaceSwitchProof(fixture, proof)).toThrow();
  });
});
