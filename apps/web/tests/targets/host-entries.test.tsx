// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import { ExportDiagnosticsRow } from '../../src/components/ExportDiagnosticsButton';
import { FileViewer } from '../../src/components/FileViewer';
import { connectConnector } from '../../src/providers/registry';
import * as entry0 from '../../src/runtime/project-folders';
import * as desktop0 from '../../src/runtime/project-folders/desktop';
import * as web0 from '../../src/runtime/project-folders/web';
import * as entry1 from '../../src/runtime/project-directory';
import * as desktop1 from '../../src/runtime/project-directory/desktop';
import * as web1 from '../../src/runtime/project-directory/web';
import * as entry2 from '../../src/runtime/diagnostics-export';
import * as desktop2 from '../../src/runtime/diagnostics-export/desktop';
import * as web2 from '../../src/runtime/diagnostics-export/web';
import * as entry3 from '../../src/runtime/connector-authorization';
import * as desktop3 from '../../src/runtime/connector-authorization/desktop';
import * as web3 from '../../src/runtime/connector-authorization/web';
import * as entry4 from '../../src/runtime/external-navigation';
import * as desktop4 from '../../src/runtime/external-navigation/desktop';
import * as web4 from '../../src/runtime/external-navigation/web';
import * as entry5 from '../../src/runtime/export-download';
import * as desktop5 from '../../src/runtime/export-download/desktop';
import * as web5 from '../../src/runtime/export-download/web';
import * as entry6 from '../../src/runtime/brand-browser';
import * as desktop6 from '../../src/runtime/brand-browser/desktop';
import * as web6 from '../../src/runtime/brand-browser/web';
import * as entry7 from '../../src/runtime/client-context';
import * as desktop7 from '../../src/runtime/client-context/desktop';
import * as web7 from '../../src/runtime/client-context/web';
import * as entry8 from '../../src/runtime/campaign-support';
import * as desktop8 from '../../src/runtime/campaign-support/desktop';
import * as web8 from '../../src/runtime/campaign-support/web';
import * as entry9 from '../../src/runtime/preview-navigation';
import * as desktop9 from '../../src/runtime/preview-navigation/desktop';
import * as web9 from '../../src/runtime/preview-navigation/web';
import * as entry10 from '../../src/lib/updater';
import * as desktop10 from '../../src/lib/updater/desktop';
import * as web10 from '../../src/lib/updater/web';
import * as entry11 from '../../src/runtime/exports';
import * as desktop11 from '../../src/runtime/exports/desktop';
import * as web11 from '../../src/runtime/exports/web';
import * as entry12 from '../../src/components/BrowserSurface';
import * as desktop12 from '../../src/components/BrowserSurface/Desktop';
import * as web12 from '../../src/components/BrowserSurface/Web';

const webTarget = process.env.OD_WEB_TARGET === 'web';
let restoreHost: (() => void) | undefined;
afterEach(() => {
  cleanup();
  restoreHost?.();
  restoreHost = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.openDesignDesktop;
});

it('resolves every native integration entry through the target map', () => {
  for (const [name, implementation] of Object.entries(webTarget ? web0 : desktop0)) {
    expect((entry0 as Record<string, unknown>)[name], 'runtime/project-folders/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web1 : desktop1)) {
    expect((entry1 as Record<string, unknown>)[name], 'runtime/project-directory/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web2 : desktop2)) {
    expect((entry2 as Record<string, unknown>)[name], 'runtime/diagnostics-export/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web3 : desktop3)) {
    expect(
      (entry3 as Record<string, unknown>)[name],
      'runtime/connector-authorization/' + name,
    ).toBe(implementation);
  }
  for (const [name, implementation] of Object.entries(webTarget ? web4 : desktop4)) {
    expect((entry4 as Record<string, unknown>)[name], 'runtime/external-navigation/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web5 : desktop5)) {
    expect((entry5 as Record<string, unknown>)[name], 'runtime/export-download/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web6 : desktop6)) {
    expect((entry6 as Record<string, unknown>)[name], 'runtime/brand-browser/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web7 : desktop7)) {
    expect((entry7 as Record<string, unknown>)[name], 'runtime/client-context/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web8 : desktop8)) {
    expect((entry8 as Record<string, unknown>)[name], 'runtime/campaign-support/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web9 : desktop9)) {
    expect((entry9 as Record<string, unknown>)[name], 'runtime/preview-navigation/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web10 : desktop10)) {
    expect((entry10 as Record<string, unknown>)[name], 'lib/updater/' + name).toBe(implementation);
  }
  for (const [name, implementation] of Object.entries(webTarget ? web11 : desktop11)) {
    expect((entry11 as Record<string, unknown>)[name], 'runtime/exports/' + name).toBe(
      implementation,
    );
  }
  for (const [name, implementation] of Object.entries(webTarget ? web12 : desktop12)) {
    expect((entry12 as Record<string, unknown>)[name], 'components/BrowserSurface/' + name).toBe(
      implementation,
    );
  }
});

it('selects the browser surface at build time, with a browser-dev fallback in desktop', () => {
  const props = {
    src: 'https://example.test',
    title: 'Design browser',
    onNativeView: vi.fn(),
    onFrameLoad: vi.fn(),
  };
  const view = render(<entry12.BrowserSurface {...props} />);
  expect(view.container.querySelector('iframe')).not.toBeNull();
  view.unmount();
  restoreHost = installMockOpenDesignHost();
  const hosted = render(<entry12.BrowserSurface {...props} />);
  expect(Boolean(hosted.container.querySelector('webview'))).toBe(!webTarget);
  expect(Boolean(hosted.container.querySelector('iframe'))).toBe(webTarget);
  if (!webTarget)
    expect(hosted.container.querySelector('webview')?.getAttribute('allowpopups')).toBe('true');
});

it('executes the selected folder picker without leaking native tokens to the web target', async () => {
  const picker = vi.fn(async () => ({
    ok: true as const,
    baseDir: '/native',
    token: 'native-token',
  }));
  restoreHost = installMockOpenDesignHost({ host: { project: { pickWorkingDir: picker } } });
  const fetcher = vi.fn(async () => Response.json({ path: '/browser' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await entry0.pickWorkingDir()).toEqual(
    webTarget
      ? { ok: true, baseDir: '/browser', token: null }
      : { ok: true, baseDir: '/native', token: 'native-token' },
  );
  expect(picker).toHaveBeenCalledTimes(webTarget ? 0 : 1);
  expect(fetcher).toHaveBeenCalledTimes(webTarget ? 1 : 0);
});

it('keeps browser development usable through the selected directory and diagnostics operations', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) =>
      String(input).includes('diagnostics')
        ? new Response('zip', {
            headers: { 'content-disposition': 'attachment; filename="logs.zip"' },
          })
        : Response.json({ path: '/browser' }),
    ),
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:logs');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await entry0.pickWorkingDir()).toEqual({ ok: true, baseDir: '/browser', token: null });
  expect(await entry2.exportDiagnostics()).toEqual({ ok: true, path: 'logs.zip' });
  expect(await entry1.createProjectDirectoryLauncher().open('p')).toEqual({
    kind: 'web-fallback',
    ok: true,
  });
});

it('drives the real diagnostics button through its selected operation', async () => {
  const native = vi.fn(async () => ({ ok: true as const, path: 'native-logs.zip' }));
  window.openDesignDesktop = { exportDiagnostics: native };
  const fetcher = vi.fn(
    async () =>
      new Response('zip', {
        headers: { 'content-disposition': 'attachment; filename="browser-logs.zip"' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:logs');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<ExportDiagnosticsRow />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      webTarget ? 'browser-logs.zip' : 'native-logs.zip',
    ),
  );
  expect(native).toHaveBeenCalledTimes(webTarget ? 0 : 1);
});

it('drives PDF export from FileViewer through the selected protocol with a host present', async () => {
  restoreHost = installMockOpenDesignHost();
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/export/pdf')
      ? new Response('%PDF-1.7\nfixture', { headers: { 'content-type': 'application/pdf' } })
      : Response.json({}),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:pdf');
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(
    <FileViewer
      projectId="p"
      projectKind="prototype"
      file={{
        name: 'index.html',
        path: 'index.html',
        type: 'file',
        size: 100,
        mtime: 1,
        kind: 'html',
        mime: 'text/html',
      }}
      liveHtml="<main>Page</main>"
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: /export/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as PDF' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  const calls = fetcher.mock.calls.filter(([input]) => String(input).includes('/export/pdf'));
  expect(calls.map(([input]) => input)).toEqual([
    webTarget ? '/api/projects/p/export/pdf' : '/api/projects/p/export/pdf-image',
  ]);
});

it('keeps connector popup activation synchronous through the real provider entry', async () => {
  const native = vi.fn(async () => ({ ok: true as const }));
  restoreHost = installMockOpenDesignHost({ host: { shell: { openExternal: native } } });
  const popup = { location: { replace: vi.fn() } } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) =>
      String(input).includes('/prepare')
        ? Response.json({ results: { github: { status: 'ready' } } })
        : Response.json({
            auth: { kind: 'redirect_required', redirectUrl: 'https://auth.example.test/authorize' },
          }),
    ),
  );
  const connecting = connectConnector('github');
  expect(open).toHaveBeenCalledTimes(webTarget ? 1 : 0);
  expect(await connecting).not.toHaveProperty('error');
  expect(native).toHaveBeenCalledTimes(webTarget ? 0 : 1);
  expect(popup.location.replace).toHaveBeenCalledTimes(webTarget ? 1 : 0);
});
