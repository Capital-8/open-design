// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StandaloneConversationAccess } from '../../src/components/StandaloneConversationAccess';
import { currentWorkspaceContextRequestToken } from '../../src/collab/useWorkspaceContext';
import { currentWorkspaceAccountGeneration } from '../../src/collab/workspace-identity';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../src/components/CloudSignInTip', () => ({
  RailAccountRecoveryTip: () => <span>Recovering account</span>,
  CloudSignInTip: () => <button>Sign in</button>,
}));
afterEach(cleanup);

describe('standalone conversation authority boundary', () => {
  it.each(['unavailable', 'reauth-required'] as const)('does not mount a conversation reader when workspace resolution is %s', (failure) => {
    const read = vi.fn();
    function ConversationReader() {
      useEffect(() => { read(); }, []);
      return <div>Conversation history</div>;
    }
    const view = render(<StandaloneConversationAccess state={{ loading: false, failure }}><ConversationReader /></StandaloneConversationAccess>);
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText('Conversation history')).toBeNull();
    expect(screen.getByText(failure === 'unavailable' ? 'Recovering account' : 'Sign in')).toBeTruthy();
    view.rerender(<StandaloneConversationAccess state={{ loading: false }}><ConversationReader /></StandaloneConversationAccess>);
    expect(read).toHaveBeenCalledOnce();
    expect(screen.getByText('Conversation history')).toBeTruthy();
    // A later outage must retire the old view too, not leave its private
    // transcript mounted or restart it under a temporary null context.
    view.rerender(<StandaloneConversationAccess state={{ loading: false, failure }}><ConversationReader /></StandaloneConversationAccess>);
    expect(read).toHaveBeenCalledOnce();
    expect(screen.queryByText('Conversation history')).toBeNull();
  });

  it.each([{ loading: true }, { loading: false, identityChangePending: true }])('keeps reads unmounted while identity is pending (%j)', (state) => {
    const mounted = vi.fn();
    function Reader() { mounted(); return null; }
    render(<StandaloneConversationAccess state={state}><Reader /></StandaloneConversationAccess>);
    expect(mounted).not.toHaveBeenCalled();
  });

  it('allows a resolved local scope and the supported legacy headerless path', () => {
    const view = render(<StandaloneConversationAccess state={{ loading: false }}><div>Local conversation</div></StandaloneConversationAccess>);
    expect(screen.getByText('Local conversation')).toBeTruthy();
    view.rerender(<StandaloneConversationAccess state={{ loading: false, failure: 'unsupported' }}><div>Local conversation</div></StandaloneConversationAccess>);
    expect(screen.getByText('Local conversation')).toBeTruthy();
  });

  it('retries only the current read without changing the account generation or workspace token', () => {
    const token = currentWorkspaceContextRequestToken();
    const generation = currentWorkspaceAccountGeneration();
    const retry = vi.fn();
    window.addEventListener('od:workspace-context-retry', retry);
    try {
      render(<StandaloneConversationAccess state={{ loading: false, failure: 'unavailable' }}><div>Private</div></StandaloneConversationAccess>);
      fireEvent.click(screen.getByRole('button', { name: 'preview.retry' }));
      expect(retry).toHaveBeenCalledOnce();
      expect((retry.mock.calls[0]![0] as CustomEvent).detail).toEqual({ requestKey: token });
      expect(currentWorkspaceAccountGeneration()).toBe(generation);
      expect(currentWorkspaceContextRequestToken()).toBe(token);
      expect(screen.queryByText('Private')).toBeNull();
    } finally { window.removeEventListener('od:workspace-context-retry', retry); }
  });
});
