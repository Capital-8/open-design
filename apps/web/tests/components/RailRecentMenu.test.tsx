// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RailRecentMenu } from '../../src/components/entry-nav-rail/RailRecentMenu';

vi.mock('../../src/i18n', () => ({ useT: () => (key: string) => key }));

afterEach(cleanup);

it('keeps the project actions in order and requires a second click to delete', () => {
  const rowRef = createRef<HTMLDivElement>();
  const onClose = vi.fn();
  const onRename = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  render(<>
    <div ref={rowRef} />
    <RailRecentMenu
      projectId="p1"
      projectName="Project one"
      anchor={{ top: 10, left: 20 }}
      rowRef={rowRef}
      onClose={onClose}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  </>);

  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    'designs.menuRename', 'workspace.copyProject', 'workspace.shareToTeam',
    'preview.exportMenu', 'designs.menuDelete',
  ]);

  fireEvent.click(screen.getByRole('menuitem', { name: 'designs.menuDelete' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'designs.renameSave' }));
  expect(onDelete).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('dismisses the portalled menu on Escape and an outside pointer press', () => {
  const rowRef = createRef<HTMLDivElement>();
  const onClose = vi.fn();
  render(<>
    <div ref={rowRef} />
    <RailRecentMenu
      projectId="p1"
      projectName="Project one"
      anchor={{ top: 10, left: 20 }}
      rowRef={rowRef}
      onClose={onClose}
    />
  </>);

  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.pointerDown(document.body);
  expect(onClose).toHaveBeenCalledTimes(2);
});
