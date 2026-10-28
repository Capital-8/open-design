import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import { exportAsPdf } from '../../../src/runtime/exports/desktop';

describe('injected print-ready parent cache script — runtime behavior (#4458)', () => {
  // Issue #4458 calls out that the existing coverage only proves script
  // *strings* are injected, never that the injected script *behaves*. These
  // specs extract the real parent-cache <script> from a live export, run it,
  // and drive it with postMessage to assert the runtime size gate: a usable
  // size is cached for the desktop inferPageSize(); a zero or non-finite size
  // is rejected so it cannot blank the page (viewport fallback) or poison it.
  async function extractCacheScript(): Promise<{ body: string; nonce: string }> {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({ host: { pdf: { print: printPdfMock } } });
    try {
      await exportAsPdf('<div style="height:4000px">tall artifact</div>', 'Cache Eval');
    } finally {
      restoreHost();
    }
    const htmlArg = printPdfMock.mock.calls[0]![0] as string;
    const match = /<script>(window\.__odPrintReady=false;[\s\S]*?)<\/script>/.exec(htmlArg);
    if (!match) throw new Error('parent cache script not found in exported HTML');
    const body = match[1]!;
    const nonceMatch = /nonce===['"]([^'"]+)['"]/.exec(body);
    if (!nonceMatch) throw new Error('nonce not found in parent cache script');
    return { body, nonce: nonceMatch[1]! };
  }

  // This suite runs in the node environment (no DOM), so we drive the real
  // injected script against a minimal fake `window`: a plain object with a
  // message-listener registry. The script wires its handler through
  // `window.addEventListener('message', …)`, so dispatching a message means
  // invoking the registered handler with a `{ data, source }` event — exactly
  // what a real `postMessage` delivers, including the source-identity check.
  type FakeWindow = Record<string, unknown> & {
    __odPrintReady?: unknown;
    __odPrintSize?: unknown;
  };

  function loadCache(body: string): { win: FakeWindow; fire: (event: unknown) => void } {
    const handlers: Array<(event: unknown) => void> = [];
    const win: FakeWindow = {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === 'message') handlers.push(fn);
      },
      removeEventListener: () => undefined,
    };
    win.frames = [win];
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function('window', body)(win);
    return { win, fire: (event) => handlers.slice().forEach((h) => h(event)) };
  }

  function readyEvent(
    nonce: string,
    width: unknown,
    height: unknown,
    source: unknown,
  ): { data: unknown; source: unknown } {
    return { data: { type: 'OD_PRINT_READY', nonce, width, height }, source };
  }

  it('caches a usable content size so the desktop bridge sizes the page to the artifact', async () => {
    const { body, nonce } = await extractCacheScript();
    const { win, fire } = loadCache(body);
    fire(readyEvent(nonce, 1440, 2000, win));
    expect(win.__odPrintReady).toBe(true);
    expect(win.__odPrintSize).toEqual({ width: 1440, height: 2000 });
  });

  it('rejects a zero size so the page does not fall back to the wrapper viewport and blank', async () => {
    const { body, nonce } = await extractCacheScript();
    const { win, fire } = loadCache(body);
    fire(readyEvent(nonce, 0, 0, win));
    // Readiness still resolves (so the desktop bridge never hangs), but the
    // size is withheld so inferPageSize cannot adopt a blank wrapper viewport.
    expect(win.__odPrintReady).toBe(true);
    expect(win.__odPrintSize).toBeNull();
  });

  it('rejects a non-finite size so Infinity cannot poison the page size', async () => {
    const { body, nonce } = await extractCacheScript();
    const { win, fire } = loadCache(body);
    fire(readyEvent(nonce, Number.POSITIVE_INFINITY, 100, win));
    expect(win.__odPrintSize).toBeNull();
  });

  it('ignores a print-ready message carrying the wrong nonce (anti-spoof)', async () => {
    const { body } = await extractCacheScript();
    const { win, fire } = loadCache(body);
    fire(readyEvent('not-the-real-nonce', 1440, 2000, win));
    expect(win.__odPrintReady).toBe(false);
    expect(win.__odPrintSize).toBeNull();
  });
});

describe('native PDF exports', () => {
  let capturedBlob: Blob | undefined;
  let openedFeatures: string | undefined;
  let mockWin: { opener: unknown; location: { href: string } };
  let openCalls: string[][];

  beforeEach(() => {
    capturedBlob = undefined;
    openedFeatures = undefined;
    openCalls = [];
    mockWin = { opener: {}, location: { href: '' } };
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return 'blob:test';
      },
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('window', {
      location: {
        href: 'https://open-design.test/plugins/example',
        origin: 'https://open-design.test',
      },
      open: (_url: string, _target: string, features?: string) => {
        openCalls.push([_url, _target]);
        openedFeatures = features;
        return mockWin;
      },
      addEventListener: () => {},
    });
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the desktop native print bridge when the host PDF bridge is available', async () => {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({
      host: { pdf: { print: printPdfMock } },
    });

    try {
      await exportAsPdf(
        '<script>window.parent.document.body.innerHTML="owned"</script>',
        'Desktop PDF',
      );
    } finally {
      restoreHost();
    }

    expect(printPdfMock).toHaveBeenCalledTimes(1);
    expect(openCalls).toEqual([]);

    const htmlArg = printPdfMock.mock.calls[0]![0];
    expect(htmlArg).toContain('sandbox="allow-scripts"');
    expect(htmlArg).not.toContain('allow-modals');
    expect(htmlArg).toContain(
      '&lt;script&gt;window.parent.document.body.innerHTML=&quot;owned&quot;&lt;/script&gt;',
    );
    expect(htmlArg).not.toContain('<script>window.parent.document.body.innerHTML="owned"</script>');
    // Verify the readiness handshake is present — the sandboxed iframe posts
    // 'OD_PRINT_READY' to the parent once fonts and images are loaded.
    expect(htmlArg).toContain('OD_PRINT_READY');
    // Verify the parent-wrapper cache script is present so the handshake is
    // never missed even if 'OD_PRINT_READY' fires before the listener attaches.
    expect(htmlArg).toContain('__odPrintReady');
    // Verify the print script is NOT injected — Electron renders via the
    // native printToPDF path, so a self-printing document would trigger a
    // second print dialog.
    expect(htmlArg).not.toContain('window.print()');
  });

  it('passes deck intent through the desktop native print bridge', async () => {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({
      host: { pdf: { print: printPdfMock } },
    });

    try {
      await exportAsPdf('<section class="slide">One</section>', 'Desktop Deck', { deck: true });
    } finally {
      restoreHost();
    }

    expect(printPdfMock).toHaveBeenCalledTimes(1);
    expect(printPdfMock.mock.calls[0]![2]).toEqual({ deck: true });
    expect(printPdfMock.mock.calls[0]![0]).toContain('data-deck-print=&quot;injected&quot;');
  });

  it('injects image-waiting logic into the print-ready handshake for the desktop bridge', async () => {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({
      host: { pdf: { print: printPdfMock } },
    });

    // HTML with an intentionally non-loadable image to exercise the
    // incomplete-image detection in the injected handshake.
    const html = '<div><img src="https://example.com/will-not-load.png" alt="test"/></div>';
    try {
      await exportAsPdf(html, 'Image Test');
    } finally {
      restoreHost();
    }

    const htmlArg = printPdfMock.mock.calls[0]![0];
    // In the sandboxed wrapper the srcdoc attribute is HTML-escaped, so the
    // handshake script content is present as unescaped JS fragments.
    expect(htmlArg).toContain('document.images');
    expect(htmlArg).toContain("img.loading==='lazy'");
    expect(htmlArg).toContain("img.loading='eager'");
    expect(htmlArg).toContain("img.addEventListener('load'");
    expect(htmlArg).toContain("img.addEventListener('error'");
    expect(htmlArg).toContain('img.complete');
    expect(htmlArg).toContain('waitForCssBackgroundImages');
    expect(htmlArg).toContain('window.getComputedStyle');
    expect(htmlArg).toContain('style.backgroundImage');
    expect(htmlArg).toContain('style.borderImageSource');
    expect(htmlArg).toContain('style.listStyleImage');
    expect(htmlArg).toContain('new Image()');
    expect(htmlArg).toContain('requestAnimationFrame');
    // The original font- and load-waiting logic must still be present.
    expect(htmlArg).toContain('document.fonts');
    expect(htmlArg).toContain('OD_PRINT_READY');
    // The handshake posts an object with a per-export nonce to prevent
    // spoofing by untrusted artifact code.
    expect(htmlArg).toContain("type:'OD_PRINT_READY'");
    expect(htmlArg).toContain("nonce:'");
    // The cache script also validates the nonce and event source.
    expect(htmlArg).toContain("e.data.type==='OD_PRINT_READY'");
    expect(htmlArg).toContain('e.data.nonce===');
    expect(htmlArg).toContain('e.source===');
    // The parent cache should still be injected.
    expect(htmlArg).toContain('__odPrintReady');
    // No window.print() since the desktop bridge handles printing natively.
    expect(htmlArg).not.toContain('window.print()');
  });

  it('reports the artifact content size through the handshake so the desktop page is sized to the content, not the wrapper viewport (issue #4067)', async () => {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({
      host: { pdf: { print: printPdfMock } },
    });

    try {
      await exportAsPdf('<div style="height:4000px">tall artifact</div>', 'Tall PDF');
    } finally {
      restoreHost();
    }

    const htmlArg = printPdfMock.mock.calls[0]![0];
    // The in-iframe handshake measures the artifact's own document dimensions.
    // The parent wrapper cannot do this itself: the sandboxed preview iframe is
    // `allow-scripts` with no `allow-same-origin`, so iframe.contentDocument is
    // null. Measuring from inside is the only way to learn the real size.
    expect(htmlArg).toContain('document.documentElement');
    expect(htmlArg).toContain('scrollHeight');
    expect(htmlArg).toContain('offsetHeight');
    // ...and it ships that size to the parent, but only once the content has a
    // usable (non-zero) size, by driving the measurement through
    // reportPrintSizeWhenStable. The polling/gating behavior itself is covered
    // by the reportPrintSizeWhenStable unit tests above (real-logic behavior
    // assertions, not string presence); here we assert the handshake is wired
    // to it so a heavier artifact that lays out late is not reported at size 0,
    // which would blank the PDF (#4458).
    expect(htmlArg).toContain('reportPrintSizeWhenStable');
    expect(htmlArg).toContain('width:size.width');
    expect(htmlArg).toContain('height:size.height');
    // The parent wrapper caches the reported size for inferPageSize() to read,
    // gating it through isUsablePrintSize so a malformed/oversized message
    // cannot poison the page size. The finite check matters: `Infinity > 0` is
    // true, so a bare `typeof === 'number'` guard would cache a non-finite
    // dimension and let it leak into the page size. (isUsablePrintSize's own
    // boundary behavior is covered by its unit tests above.)
    expect(htmlArg).toContain('window.__odPrintSize');
    expect(htmlArg).toContain('__odUsable(e.data.width,e.data.height)');
    expect(htmlArg).toContain('Number.isFinite(width)');
  });

  it('injects the readiness cache for non-sandboxed desktop exports too', async () => {
    const printPdfMock = vi.fn().mockResolvedValue({ ok: true });
    const restoreHost = installMockOpenDesignHost({
      host: { pdf: { print: printPdfMock } },
    });

    try {
      await exportAsPdf('<main>Trusted local document</main>', 'Trusted', {
        sandboxedPreview: false,
      });
    } finally {
      restoreHost();
    }

    expect(printPdfMock).toHaveBeenCalledTimes(1);
    const htmlArg = printPdfMock.mock.calls[0]![0];
    // No sandbox wrapper — the document is passed through directly.
    expect(htmlArg).not.toContain('sandbox="allow-scripts"');
    expect(htmlArg).toContain('<main>Trusted local document</main>');
    // The readiness handshake must still be injected.
    expect(htmlArg).toContain('OD_PRINT_READY');
    // The cache must be present so waitForPrintReadyHandshake never hangs.
    expect(htmlArg).toContain('__odPrintReady');
    // No window.print() since the desktop bridge handles printing natively.
    expect(htmlArg).not.toContain('window.print()');
  });
  it('uses the existing browser print fallback when the desktop build has no host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await exportAsPdf('<main>Browser development</main>', 'Local browser');
      expect(openCalls).toEqual([['', '_blank']]);
      expect(await capturedBlob?.text()).toContain('allow-modals');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
