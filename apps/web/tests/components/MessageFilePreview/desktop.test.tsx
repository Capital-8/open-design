// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageFilePreview } from '../../../src/components/MessageFilePreview/Desktop';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('preserves the message container and link handling without cloud reads', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const onClick = vi.fn(event => event.preventDefault());
  render(<MessageFilePreview projectId="p" id="message" className="msg" onClick={onClick}>
    <a href="/run/workspace/index.html">Design</a>
  </MessageFilePreview>);
  const link = screen.getByRole('link');
  fireEvent.click(link);
  expect(onClick).toHaveBeenCalledOnce();
  expect(link.parentElement?.id).toBe('message');
  expect(link.parentElement?.className).toBe('msg');
  expect(link.parentElement?.hasAttribute('projectId')).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
