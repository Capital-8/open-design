// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const webTarget = process.env.OD_WEB_TARGET === 'web';
import { useEffect } from 'react';
import { AssistantMessage } from '../../src/components/AssistantMessage';
import type { ChatMessage } from '../../src/types';

// Keep this integration test focused on the real message click / file read /
// isolated iframe. PreviewModal chrome is covered by its own component tests.
vi.mock('../../src/components/PreviewModal', () => ({ PreviewModal: ({ views, onView, onClose }: any) => {
  useEffect(() => { onView?.('index.html'); }, [onView]);
  return <div role="dialog"><button onClick={onClose}>Close</button>{views[0].error ? <button onClick={() => onView('index.html')}>Retry</button> : views[0].custom ?? <span>Loading</span>}</div>;
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const message: ChatMessage = { id: 'm', role: 'assistant', content: '[打开 index.html](/run/workspace/index.html)', events: [{ kind: 'text', text: '[打开 index.html](/run/workspace/index.html)' }], startedAt: 1, endedAt: 2, runStatus: 'succeeded' };
function show(projectId = 'project-a', streaming = false) {
  return <AssistantMessage message={message} streaming={streaming} projectId={projectId} />;
}
it.runIf(webTarget).each([false, true])('opens the current project cloud file with streaming=%s and an unchanged link', async (streaming) => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ html: '<h1>Cloud design</h1>' }) });
  vi.stubGlobal('fetch', fetcher);
  render(show('project-a', streaming));
  const link = screen.getByRole('link', { name: '打开 index.html' });
  expect(link.getAttribute('href')).toBe('/run/workspace/index.html');
  fireEvent.click(link);
  const frame = await screen.findByTitle('index.html');
  expect(fetcher).toHaveBeenCalledWith('/api/projects/project-a/files/index.html', expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }));
  expect(frame.getAttribute('srcdoc')).toContain('Cloud design');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.hasAttribute('src')).toBe(false);
  fireEvent.click(screen.getByText('Close'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.skipIf(webTarget)('does not enable cloud reads in desktop builds', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(show()); fireEvent.click(screen.getByRole('link'));
  expect(fetcher).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});
