// @vitest-environment jsdom
//
// OPEND-3922: creating a project from Home hands the first turn across three
// surfaces — the pending frame's card, ProjectView's hand-off card, then the
// real ChatPane. Every `.msg` plays `msg-enter` on mount, so each hand-over
// faded the same rows in from transparent again and the chat column flashed
// twice. A surface that takes over rows already on screen marks them
// `data-enter="skip"`; rows that first appear later keep their entrance.

import { cleanup, render } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import { ProjectCreationPendingChat } from '../../src/components/ProjectCreationPendingView';
import { I18nProvider } from '../../src/i18n';
import type { ChatMessage } from '../../src/types';

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef(() => <div />),
}));

afterEach(cleanup);

function messageRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.msg')];
}

describe('hand-off card', () => {
  it('the pending frame (first surface to show the turn) keeps the entrance', () => {
    const view = render(
      <I18nProvider initial="en">
        <ProjectCreationPendingChat projectName="P" prompt="Make a landing page" />
      </I18nProvider>,
    );
    const rows = messageRows(view.container);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.hasAttribute('data-enter')).toBe(false);
  });

  it("ProjectView's card takes over rows already on screen, so it skips the entrance", () => {
    const view = render(
      <I18nProvider initial="en">
        <ProjectCreationPendingChat projectName="P" prompt="Make a landing page" settled />
      </I18nProvider>,
    );
    const rows = messageRows(view.container);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.getAttribute('data-enter')).toBe('skip');
  });
});

const userTurn: ChatMessage = { id: 'u1', role: 'user', content: 'Make a landing page', createdAt: 1 };
const assistantTurn: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: '',
  createdAt: 2,
  events: [{ kind: 'text', text: 'Working on it' }],
};
const laterUserTurn: ChatMessage = { id: 'u2', role: 'user', content: 'Make it blue', createdAt: 3 };

function pane(messages: ChatMessage[], composerLayerHidden: boolean) {
  return (
    <I18nProvider initial="en">
      <ChatPane
        messages={messages}
        streaming={false}
        error={null}
        projectId="p1"
        projectFiles={[]}
        onEnsureProject={async () => 'p1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onNewConversation={vi.fn()}
        activeConversationId="c1"
        conversations={[{ id: 'c1', projectId: 'p1', title: 'First', createdAt: 1, updatedAt: 1 }]}
        composerLayerHidden={composerLayerHidden}
      />
    </I18nProvider>
  );
}

function rowFor(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-chat-message-id="${id}"], [data-assistant-message-id="${id}"]`,
  );
  if (!row) throw new Error(`row ${id} did not render`);
  return row;
}

describe('ChatPane parked under the hand-off card', () => {
  it('rows rendered while parked skip the entrance once the card comes down', () => {
    const view = render(pane([userTurn, assistantTurn], true));
    view.rerender(pane([userTurn, assistantTurn], false));
    expect(rowFor(view.container, 'u1').getAttribute('data-enter')).toBe('skip');
    expect(rowFor(view.container, 'a1').getAttribute('data-enter')).toBe('skip');
  });

  it('a message that arrives after the pane is visible still plays its entrance', () => {
    const view = render(pane([userTurn, assistantTurn], true));
    view.rerender(pane([userTurn, assistantTurn], false));
    view.rerender(pane([userTurn, assistantTurn, laterUserTurn], false));
    expect(rowFor(view.container, 'u1').getAttribute('data-enter')).toBe('skip');
    expect(rowFor(view.container, 'u2').hasAttribute('data-enter')).toBe(false);
  });

  it('a pane that was never parked (opening an existing project) keeps every entrance', () => {
    const view = render(pane([userTurn, assistantTurn], false));
    expect(rowFor(view.container, 'u1').hasAttribute('data-enter')).toBe(false);
    expect(rowFor(view.container, 'a1').hasAttribute('data-enter')).toBe(false);
  });
});
