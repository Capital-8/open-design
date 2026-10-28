// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';

const webTarget = process.env.OD_WEB_TARGET === 'web';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// FileViewer, the component entry and the export entry all remain real. Only
// HTTP and the browser download boundary are replaced.
it('runs the selected MP4 menu and export transport from the real FileViewer', async () => {
  const bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0]);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/export/mp4')
    ? new Response(bytes, { headers: { 'content-type': 'video/mp4' } })
    : Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:motion');
    static revokeObjectURL = vi.fn();
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<FileViewer projectId="p" projectKind="video"
    file={{ name: 'index.html', path: 'index.html', type: 'file', size: 100, mtime: 1, kind: 'html', mime: 'text/html' }}
    liveHtml='<main data-composition-id="main" data-duration="2">Motion</main>' />);
  fireEvent.click(await screen.findByRole('button', { name: /export/i }));
  if (webTarget) {
    fireEvent.click(await screen.findByRole('menuitem', { name: 'MP4' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p/export/mp4', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'video/mp4' }));
  } else {
    expect(screen.queryByRole('menuitem', { name: 'MP4' })).toBeNull();
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/export/mp4'))).toBe(false);
    expect(click).not.toHaveBeenCalled();
  }
});
