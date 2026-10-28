// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { MessageFilePreview } from '../../../src/components/MessageFilePreview/Web';

// Keep this integration test focused on the real message click / file read /
// isolated iframe. PreviewModal chrome is covered by its own component tests.
vi.mock('../../../src/components/PreviewModal', () => ({ PreviewModal: ({ views, onView, onClose }: any) => {
  useEffect(() => { onView?.('index.html'); }, [onView]);
  return <div role="dialog"><button onClick={onClose}>Close</button>{views[0].error ? <button onClick={() => onView('index.html')}>Retry</button> : views[0].custom ?? <span>Loading</span>}</div>;
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show(projectId = 'project-a') {
  return <MessageFilePreview projectId={projectId}><a href="/run/workspace/index.html">打开 index.html</a></MessageFilePreview>;
}
it('shows failure and retries instead of presenting denied content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }).mockResolvedValueOnce({ ok: true, json: async () => ({ html: '<p>Retry succeeded</p>' }) });
  vi.stubGlobal('fetch', fetcher);
  render(show()); fireEvent.click(screen.getByRole('link'));
  fireEvent.click(await screen.findByText('Retry'));
  expect((await screen.findByTitle('index.html')).getAttribute('srcdoc')).toContain('Retry succeeded');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('aborts a pending read and cannot show the previous project after switching', async () => {
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(show()); fireEvent.click(screen.getByRole('link'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  view.rerender(show('project-b'));
  expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => ({ html: '<h1>Wrong project</h1>' }) });
  expect(screen.queryByRole('dialog')).toBeNull();
});
