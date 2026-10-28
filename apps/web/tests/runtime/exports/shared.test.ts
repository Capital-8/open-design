import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveFilenameFrom,
  archiveRootFromFilePath,
  buildDesignHandoffContent,
  buildDesignManifestContent,
  downloadImageDataUrl,
  buildSandboxedPreviewDocument,
  downloadDesignSystemArchive,
  downloadProjectArchive,
  exportAsImage,
  exportAsMd,
  exportBrowserPdf as exportAsPdf,
  isUsablePrintSize,
  reportPrintSizeWhenStable,
  exportProjectAsHtml,
  openSandboxedPreviewInNewTab,
  prepareImageExportTarget,
  planDeckImageCapture,
  requestPreviewSnapshot,
  sourceLooksLikeExportableDeck,
  sourceLooksLikeNavigableDeck,
} from '../../../src/runtime/exports/shared';

describe('planDeckImageCapture (#4604 current-slide capture for runtime decks)', () => {
  it('whole-deck capture renders off-screen with no index (stitch all)', () => {
    expect(planDeckImageCapture({ deck: true, wholeDeck: true, trackedActive: 3 })).toEqual({
      useOffscreen: true,
      index: undefined,
    });
  });

  it('Export-as-image of an ordinary page renders the whole page off-screen', () => {
    expect(planDeckImageCapture({ deck: false, wholeDeck: true, trackedActive: null })).toEqual({
      useOffscreen: true,
      index: undefined,
    });
  });

  it('current-view capture of an ordinary page stays viewport-based (host snapshot)', () => {
    // Copy screenshot / captureViewport annotation must reflect what the user is
    // looking at, NOT an off-screen full-page render of the whole document.
    expect(planDeckImageCapture({ deck: false, wholeDeck: false, trackedActive: null })).toEqual({
      useOffscreen: false,
      index: undefined,
    });
  });

  it('tracked deck current-slide renders off-screen at the active index', () => {
    expect(planDeckImageCapture({ deck: true, wholeDeck: false, trackedActive: 4 })).toEqual({
      useOffscreen: true,
      index: 4,
    });
  });

  it('runtime-managed deck (no tracked active) skips off-screen → host snapshot, NOT index 0', () => {
    // The viewer doesn't track a deck-stage / data-screen-label deck's active
    // slide, so a current-slide capture must use the visible host snapshot rather
    // than off-screen-rendering slide 0.
    expect(planDeckImageCapture({ deck: true, wholeDeck: false, trackedActive: null })).toEqual({
      useOffscreen: false,
      index: undefined,
    });
  });
});

function mockResponse(headers: Record<string, string>): Response {
  return { headers: new Headers(headers) } as Response;
}

describe('sourceLooksLikeExportableDeck (#4604 horizontal deck export)', () => {
  // Runtime-managed decks (`<deck-stage>` web component with slotted
  // `<section data-screen-label>` children) carry NO literal class="slide", so
  // the viewer's `.slide`-only nav heuristic misses them and export would force a
  // single page-mode capture of slide 1. This broader signal recognizes them so
  // image/PDF capture every slide.
  it('detects a <deck-stage> runtime deck (no class="slide")', () => {
    const src =
      '<deck-stage width="1920" height="1080">' +
      '<section class="s-cover" data-screen-label="01 Cover">A</section>' +
      '<section class="s-grid" data-screen-label="02 Grid">B</section>' +
      '</deck-stage>';
    expect(sourceLooksLikeExportableDeck(src)).toBe(true);
  });

  it('detects data-screen-label slide surfaces on their own', () => {
    expect(
      sourceLooksLikeExportableDeck('<section data-screen-label="01 Intro">x</section>'),
    ).toBe(true);
  });

  it('detects explicit deck slide classes, but not plain .slide', () => {
    expect(sourceLooksLikeExportableDeck('<div class="slide">x</div>')).toBe(false);
    expect(sourceLooksLikeExportableDeck('<section class="slide">x</section>')).toBe(false);
    expect(sourceLooksLikeExportableDeck('<div class="s-cover deck-slide">x</div>')).toBe(true);
    expect(sourceLooksLikeExportableDeck('<div class="ppt-slide">x</div>')).toBe(true);
  });

  it('detects legacy html-ppt slide structure without treating every .slide as a deck', () => {
    expect(
      sourceLooksLikeExportableDeck('<section class="slide" data-title="Cover">x</section>'),
    ).toBe(true);
    expect(
      sourceLooksLikeExportableDeck('<section data-title="Cover" class="slide is-active">x</section>'),
    ).toBe(true);
    expect(
      sourceLooksLikeExportableDeck('<div class="deck"><section class="slide">x</section></div>'),
    ).toBe(true);
  });

  it('does NOT treat an ordinary page as a deck', () => {
    expect(
      sourceLooksLikeExportableDeck('<main><h1>Landing</h1><p>Hello</p></main>'),
    ).toBe(false);
    // `slideshow` is not a `slide` class token.
    expect(sourceLooksLikeExportableDeck('<div class="slideshow">x</div>')).toBe(false);
  });

  it('returns false for empty / nullish source', () => {
    expect(sourceLooksLikeExportableDeck('')).toBe(false);
    expect(sourceLooksLikeExportableDeck(null)).toBe(false);
    expect(sourceLooksLikeExportableDeck(undefined)).toBe(false);
  });
});

describe('sourceLooksLikeNavigableDeck', () => {
  it('does not turn ordinary prototype annotations into deck chrome', () => {
    expect(
      sourceLooksLikeNavigableDeck('<h1 data-screen-label="Hero title">Prototype</h1>'),
    ).toBe(false);
    expect(sourceLooksLikeNavigableDeck(
      '<main><h1 data-screen-label="Hero">Prototype</h1>' +
      '<button data-screen-label="CTA">Buy</button></main>',
    )).toBe(false);
    expect(sourceLooksLikeNavigableDeck(
      '<main><section data-screen-label="01 Hero">One</section>' +
      '<div><section data-screen-label="02 CTA">Two</section></div></main>',
    )).toBe(false);
  });

  it('ignores deck-shaped text inside report comments and scripts', () => {
    expect(sourceLooksLikeNavigableDeck(
      '<main class="doc"><h1>Annual report</h1></main>' +
      '<!-- print support waits for a <deck-stage> when one exists -->' +
      '<script>const example = "<deck-stage></deck-stage>";</script>',
    )).toBe(false);
  });

  it('keeps explicit and multi-screen persisted decks navigable', () => {
    expect(sourceLooksLikeNavigableDeck(
      '<deck-stage><section data-screen-label="Cover">A</section></deck-stage>',
    )).toBe(true);
    expect(sourceLooksLikeNavigableDeck(
      '<main><section data-screen-label="01 Cover">A</section>' +
      '<section data-screen-label="02 Agenda">B</section></main>',
    )).toBe(true);
  });
});

describe('isUsablePrintSize (#4458)', () => {
  // The print-ready handshake reports the artifact's own content size so the
  // desktop bridge can size the PDF page to it. When that size is zero or
  // invalid, the desktop path falls back to measuring the wrapper viewport,
  // which (per inferPageSize's own docs) blanks artifacts whose visible
  // content sits below the fold. Gating on a usable size prevents that.
  it('treats positive finite dimensions as usable', () => {
    expect(isUsablePrintSize(1440, 2000)).toBe(true);
    expect(isUsablePrintSize(1, 1)).toBe(true);
  });

  it('rejects zero, negative, non-finite, or non-number dimensions', () => {
    expect(isUsablePrintSize(0, 2000)).toBe(false);
    expect(isUsablePrintSize(1440, 0)).toBe(false);
    expect(isUsablePrintSize(-5, 100)).toBe(false);
    expect(isUsablePrintSize(Number.NaN, 100)).toBe(false);
    expect(isUsablePrintSize(Number.POSITIVE_INFINITY, 100)).toBe(false);
    expect(isUsablePrintSize('1440' as unknown as number, 2000)).toBe(false);
    expect(isUsablePrintSize(undefined as unknown as number, undefined as unknown as number)).toBe(false);
  });
});

describe('reportPrintSizeWhenStable (#4458)', () => {
  it('reports only once the content has a usable size, polling animation frames', () => {
    // Simulate content that has not finished layout: size is 0 for the first
    // frames, then becomes positive once laid out. The handshake must not
    // report the early zero size (which would blank the PDF).
    const sizes = [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
      { width: 1440, height: 2000 },
    ];
    let call = 0;
    const measure = (): { width: number; height: number } => sizes[Math.min(call++, sizes.length - 1)]!;
    const reported: Array<{ width: number; height: number }> = [];
    const raf = (cb: () => void): void => cb(); // run synchronously
    reportPrintSizeWhenStable(measure, (s) => reported.push(s), 30, raf);
    expect(reported).toEqual([{ width: 1440, height: 2000 }]);
  });

  it('reports the last measured size when frames are exhausted (genuinely empty content)', () => {
    // A truly empty artifact never gains a usable size; rather than hang
    // forever, report best-effort after the frame budget so the desktop
    // path is not left waiting on the readiness handshake indefinitely.
    const measure = (): { width: number; height: number } => ({ width: 0, height: 0 });
    const reported: Array<{ width: number; height: number }> = [];
    const raf = (cb: () => void): void => cb();
    reportPrintSizeWhenStable(measure, (s) => reported.push(s), 3, raf);
    expect(reported).toEqual([{ width: 0, height: 0 }]);
  });
});

describe('archiveRootFromFilePath', () => {
  it('returns the top-level directory name when present', () => {
    expect(archiveRootFromFilePath('ui-design/index.html')).toBe('ui-design');
    expect(archiveRootFromFilePath('ui-design/src/app.css')).toBe('ui-design');
  });

  it('returns empty for files at the project root', () => {
    expect(archiveRootFromFilePath('index.html')).toBe('');
    expect(archiveRootFromFilePath('README.md')).toBe('');
  });

  it('strips a leading slash before scanning', () => {
    expect(archiveRootFromFilePath('/ui-design/index.html')).toBe('ui-design');
    expect(archiveRootFromFilePath('//ui-design/index.html')).toBe('ui-design');
  });

  it('returns empty for empty/garbage input', () => {
    expect(archiveRootFromFilePath('')).toBe('');
    expect(archiveRootFromFilePath('/')).toBe('');
  });
});

describe('archiveFilenameFrom', () => {
  it('decodes the RFC 5987 UTF-8 filename* form (preserves multi-byte chars)', () => {
    // 'café-design.zip' encoded — the é is a 2-byte UTF-8 sequence (%C3%A9),
    // which is enough to fail under naive ASCII-only handling.
    const resp = mockResponse({
      'content-disposition':
        "attachment; filename=\"project.zip\"; filename*=UTF-8''caf%C3%A9-design.zip",
    });
    expect(archiveFilenameFrom(resp, 'fallback', 'ui-design')).toBe('café-design.zip');
  });

  it('falls back to the legacy quoted filename= when filename* is absent', () => {
    const resp = mockResponse({
      'content-disposition': 'attachment; filename="ui-design.zip"',
    });
    expect(archiveFilenameFrom(resp, 'fallback', 'ui-design')).toBe('ui-design.zip');
  });

  it('falls back to the active root slug when the header is missing', () => {
    const resp = mockResponse({});
    expect(archiveFilenameFrom(resp, 'fallback-title', 'ui-design')).toBe('ui-design.zip');
  });

  it('falls back to the title slug when both header and root are absent', () => {
    const resp = mockResponse({});
    expect(archiveFilenameFrom(resp, 'My Artifact', '')).toBe('My-Artifact.zip');
  });

  it('falls through to the slug when filename* is malformed', () => {
    // Truncated percent-escape — decodeURIComponent throws; we should not
    // surface the exception, just fall back to the next strategy.
    const resp = mockResponse({
      'content-disposition': "attachment; filename*=UTF-8''%E9%9D",
    });
    expect(archiveFilenameFrom(resp, 'fallback', 'ui-design')).toBe('ui-design.zip');
  });
});

describe('buildDesignHandoffContent', () => {
  it('documents coding handoff and responsive verification expectations', () => {
    const content = buildDesignHandoffContent({
      title: 'Checkout Design',
      entryFile: 'index.html',
      files: ['index.html', 'src/app.css', 'src/app.js'],
    });

    expect(content).toContain('Checkout Design implementation handoff');
    expect(content).toContain('Mobile compact: 360×800');
    expect(content).toContain('Tablet portrait: 820×1180');
    expect(content).toContain('Wide desktop: 1920×1080');
    expect(content).toContain('`src/app.css`');
    expect(content).toContain('visual system');
    expect(content).toContain('Design fidelity contract');
    expect(content).toContain('CJX-ready UX contract');
    expect(content).toContain('DESIGN-MANIFEST.json');
    expect(content).toContain('in-app modules/components');
    expect(content).toContain('OS widgets are home-screen/lock-screen/quick-access surfaces');
    expect(content).toContain('Color and brand contract');
    expect(content).toContain('Do not introduce warm beige / cream / peach / pink / orange-brown background washes');
    expect(content).toContain('Build product screens and domain-specific in-app modules');
  });

  it('builds a machine-readable design manifest for coding tools', () => {
    const manifest = JSON.parse(buildDesignManifestContent({
      title: 'Checkout Design',
      entryFile: 'index.html',
      files: ['index.html', 'src/app.css', 'src/app.js'],
    }));

    expect(manifest.schema).toBe('open-design.design-manifest.v1');
    expect(manifest.entryFile).toBe('index.html');
    expect(manifest.sourceFiles.css).toEqual(['src/app.css']);
    expect(manifest.sourceFiles.scriptsAndComponents).toEqual(['src/app.js']);
    expect(manifest.appModules.join(' ')).toContain('domain-specific in-app modules');
    expect(manifest.osWidgets.join(' ')).toContain('home-screen');
    expect(manifest.responsiveViewports).toContainEqual({
      name: 'tablet-portrait',
      width: 820,
      height: 1180,
      category: 'tablet',
      mustAvoidHorizontalScroll: true,
    });
    expect(manifest.implementationChecklist.join(' ')).toContain('landing pages, in-app modules, and OS widgets');
  });

  it('does not classify plain home.html as a landing page in the manifest', () => {
    const manifest = JSON.parse(buildDesignManifestContent({
      title: 'Product App',
      entryFile: 'home.html',
      files: ['home.html', 'dashboard.html', 'marketing.html'],
    }));

    const screens = new Map(manifest.screens.map((screen: { file: string; role: string }) => [screen.file, screen.role]));
    expect(screens.get('home.html')).not.toBe('landing-page');
    expect(screens.get('marketing.html')).toBe('landing-page');
    expect(screens.get('dashboard.html')).toBe('product-screen');
  });

  it('keeps frame wrapper HTML out of client export manifest screens', () => {
    const manifest = JSON.parse(buildDesignManifestContent({
      title: 'Framed App',
      entryFile: 'index.html',
      files: ['index.html', 'frames/iphone-15-pro.html', 'browser-chrome.html', 'src/app.css'],
    }));

    expect(manifest.sourceFiles.html).toEqual(['browser-chrome.html', 'frames/iphone-15-pro.html', 'index.html']);
    expect(manifest.screens.map((screen: { file: string }) => screen.file)).toEqual(['index.html']);
  });

  it('normalizes a frame-wrapper active file to the implementable screen entry in manifest and handoff', () => {
    const manifest = JSON.parse(buildDesignManifestContent({
      title: 'Framed App',
      entryFile: 'frames/iphone-15-pro.html',
      files: ['index.html', 'landing.html', 'frames/iphone-15-pro.html', 'src/app.css'],
    }));
    const handoff = buildDesignHandoffContent({
      title: 'Framed App',
      entryFile: 'frames/iphone-15-pro.html',
      files: ['index.html', 'landing.html', 'frames/iphone-15-pro.html', 'src/app.css'],
    });

    expect(manifest.entryFile).toBe('index.html');
    expect(manifest.screens.map((screen: { file: string }) => screen.file)).toEqual(['index.html', 'landing.html']);
    expect(handoff).toContain('Primary entry: `index.html`');
    expect(handoff).toContain('Open `index.html` and `DESIGN-MANIFEST.json`');
    expect(handoff).not.toContain('Primary entry: `frames/iphone-15-pro.html`');
  });

  it('keeps phone.html and iphone-upgrade.html as real screens when outside frames/ directory', () => {
    // phone.html as a carrier storefront screen, iphone-upgrade.html as a
    // product surface — neither should be silently dropped from screens just
    // because the filename resembles a device name.
    const manifest = JSON.parse(buildDesignManifestContent({
      title: 'Carrier Storefront',
      entryFile: 'phone.html',
      files: ['phone.html', 'iphone-upgrade.html', 'frames/browser-shell.html', 'src/app.css'],
    }));

    const screenFiles = manifest.screens.map((screen: { file: string }) => screen.file);
    expect(screenFiles).toContain('phone.html');
    expect(screenFiles).toContain('iphone-upgrade.html');
    // frame wrapper inside frames/ is still excluded
    expect(screenFiles).not.toContain('frames/browser-shell.html');
    // both real screens appear in sourceFiles.html
    expect(manifest.sourceFiles.html).toContain('phone.html');
    expect(manifest.sourceFiles.html).toContain('iphone-upgrade.html');
    expect(manifest.sourceFiles.html).toContain('frames/browser-shell.html');
  });
});

describe('exportProjectAsHtml', () => {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    capturedFilename = undefined;
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const anchor = { href: '', click: () => {} } as { href: string; download?: string; click: () => void };
        Object.defineProperty(anchor, 'download', {
          set(value: string) {
            capturedFilename = value;
          },
          get() {
            return capturedFilename ?? '';
          },
        });
        return anchor;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads daemon-inlined project HTML instead of the raw source body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><p>inlined</p>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })));

    await exportProjectAsHtml({
      projectId: 'proj 1',
      filePath: 'screens/main page.html',
      fallbackTitle: 'Main Page',
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/html', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'screens/main page.html', title: 'Main Page' }),
    });
    expect(capturedFilename).toBe('Main-Page.html');
    expect(await capturedBlob!.text()).toBe('<!doctype html><p>inlined</p>');
  });

  it('passes versionId so the daemon can explicitly reject mixed-version dependencies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><p>version</p>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })));

    await exportProjectAsHtml({
      projectId: 'proj 1',
      filePath: 'screens/main page.html',
      fallbackTitle: 'Main Page v1',
      versionId: 'v1',
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/html', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'screens/main page.html',
        title: 'Main Page v1',
        versionId: 'v1',
      }),
    });
    expect(capturedFilename).toBe('Main-Page-v1.html');
    expect(await capturedBlob!.text()).toBe('<!doctype html><p>version</p>');
  });

  it('surfaces structured daemon failures instead of downloading broken source HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { message: 'missing local dependency: assets/hero.png' },
    }, { status: 422 })));

    await expect(exportProjectAsHtml({
      projectId: 'proj-1',
      filePath: 'index.html',
      fallbackTitle: 'Fallback',
    })).rejects.toThrow('missing local dependency: assets/hero.png');

    expect(capturedFilename).toBeUndefined();
    expect(capturedBlob).toBeUndefined();
  });
});

describe('binary project/design-system downloads', () => {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    capturedFilename = undefined;
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const anchor = { href: '', click: () => {} } as { href: string; download?: string; click: () => void };
        Object.defineProperty(anchor, 'download', {
          set(value: string) {
            capturedFilename = value;
          },
          get() {
            return capturedFilename ?? '';
          },
        });
        return anchor;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the design-system archive endpoint and downloads the daemon-named zip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PKzip-bytes', {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': "attachment; filename=\"Acme.zip\"; filename*=UTF-8''Acme.zip",
      },
    })));

    const ok = await downloadDesignSystemArchive({
      designSystemId: 'user:acme brand',
      fallbackTitle: 'Acme Brand',
    });

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/design-systems/user%3Aacme%20brand/archive');
    expect(capturedFilename).toBe('Acme.zip');
    expect(await capturedBlob!.text()).toContain('zip-bytes');
  });

  it('returns false and does not download when the request fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    const ok = await downloadDesignSystemArchive({
      designSystemId: 'user:missing',
      fallbackTitle: 'Missing',
    });

    expect(ok).toBe(false);
    expect(capturedBlob).toBeUndefined();
  });

  it('downloads the backing project archive with the daemon filename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('project-zip', {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': "attachment; filename=\"Project.zip\"; filename*=UTF-8''Project.zip",
      },
    })));

    const ok = await downloadProjectArchive({
      projectId: 'project 123',
      fallbackTitle: 'Fallback Project',
    });

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/projects/project%20123/archive');
    expect(capturedFilename).toBe('Project.zip');
    expect(await capturedBlob!.text()).toContain('project-zip');
  });

  it('passes an optional root when downloading a project subfolder archive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('folder-zip', {
      status: 200,
      headers: {
        'content-type': 'application/zip',
      },
    })));

    const ok = await downloadProjectArchive({
      projectId: 'project-1',
      fallbackTitle: 'Fallback Project',
      root: '/system/',
    });

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/projects/project-1/archive?root=system');
    expect(capturedFilename).toBe('system.zip');
  });


});

// `exportAsMd` is a pass-through (the file body is the artifact source
// verbatim, only the extension and Content-Type flip). Tests exercise it
// end-to-end by stubbing the few DOM globals `triggerDownload` touches —
// we run under `environment: 'node'`, so `document` and `URL` aren't
// available by default. See issue #279.
describe('exportAsMd', () => {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    capturedFilename = undefined;
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const anchor = { href: '', click: () => {} } as { href: string; download?: string; click: () => void };
        Object.defineProperty(anchor, 'download', {
          set(value: string) {
            capturedFilename = value;
          },
          get() {
            return capturedFilename ?? '';
          },
        });
        return anchor;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the source bytes verbatim under a `.md` extension', async () => {
    const source = '<!doctype html>\n<html lang="en"><body>hi</body></html>\n';

    exportAsMd(source, 'TTC — Seed Round · 2026');

    expect(capturedBlob).toBeDefined();
    expect(capturedBlob!.type).toBe('text/markdown;charset=utf-8');
    // Critical: no transformation, no normalization, no trimming. Whatever
    // the Source view shows is what lands in the .md.
    expect(await capturedBlob!.text()).toBe(source);
    expect(capturedFilename).toBe('TTC-Seed-Round-2026.md');
  });

  it('falls back to "artifact.md" when the title is empty or unsafe', () => {
    exportAsMd('hello', '');
    expect(capturedFilename).toBe('artifact.md');

    exportAsMd('hello', '???');
    expect(capturedFilename).toBe('artifact.md');
  });

  it('keeps multi-byte content (UTF-8) intact end-to-end', async () => {
    const source = '# 中文标题\n\n这是 markdown 文件 — でも本当は HTML 源代码 (مرحبا)。\n';

    exportAsMd(source, 'mixed');

    expect(await capturedBlob!.text()).toBe(source);
  });
});

describe('sandboxed preview Blob exports', () => {
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

  it('wraps generated HTML in an opaque-origin sandbox for new-tab previews', async () => {
    openSandboxedPreviewInNewTab('<script>window.parent.localStorage.clear()</script>', 'Unsafe preview');

    expect(openedFeatures).toBe('noopener,noreferrer');
    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain('sandbox="allow-scripts"');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).toContain('&lt;script&gt;window.parent.localStorage.clear()&lt;/script&gt;');
    expect(wrapper).not.toContain('<script>window.parent.localStorage.clear()</script>');
  });

  it('anchors new-tab srcdoc previews to the current origin when no explicit base is provided', async () => {
    openSandboxedPreviewInNewTab('<img src="/api/plugins/example/assets/hero.png"><img src="assets/card.png">', 'Plugin preview');

    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain(
      '&lt;base href=&quot;https://open-design.test/&quot; data-od-project-preview-base&gt;',
    );
  });

  it('passes srcdoc options through the sandboxed new-tab wrapper', async () => {
    openSandboxedPreviewInNewTab('<section class="slide">One</section>', 'Deck preview', {
      deck: true,
      baseHref: '/artifacts/project/assets/',
      initialSlideIndex: 2,
    });

    expect(openedFeatures).toBe('noopener,noreferrer');
    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain('sandbox="allow-scripts"');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).toContain(
      '&lt;base href=&quot;/artifacts/project/assets/&quot; data-od-project-preview-base&gt;',
    );
    expect(wrapper).toContain('od:slide');
  });

  it('can build a print wrapper without granting same-origin access', () => {
    const wrapper = buildSandboxedPreviewDocument('<!doctype html><title>x</title>', 'Print', {
      allowModals: true,
    });

    expect(wrapper).toContain('sandbox="allow-scripts allow-modals"');
    expect(wrapper).not.toContain('allow-same-origin');
  });

  it('uses a sandboxed Blob wrapper with synchronous popup detection for PDF exports', async () => {
    await exportAsPdf('<script>window.parent.document.body.innerHTML="owned"</script>', 'PDF');

    expect(openCalls).toEqual([['', '_blank']]);
    expect(mockWin.opener).toBeNull();
    expect(mockWin.location.href).toBe('blob:test');
    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain('sandbox="allow-scripts allow-modals"');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).toContain('&lt;script&gt;window.parent.document.body.innerHTML=&quot;owned&quot;&lt;/script&gt;');
    expect(wrapper).not.toContain('<script>window.parent.document.body.innerHTML="owned"</script>');
  });

  it('preserves deck print handling inside sandboxed PDF exports', async () => {
    await exportAsPdf('<section class="slide">One</section>', 'Deck PDF', { deck: true });

    expect(openCalls).toEqual([['', '_blank']]);
    expect(mockWin.opener).toBeNull();
    expect(mockWin.location.href).toBe('blob:test');
    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain('sandbox="allow-scripts allow-modals"');
    expect(wrapper).toContain('data-deck-print=&quot;injected&quot;');
    expect(wrapper).toContain('page-break-after: always;');
  });

  it('waits for the injected print-ready cache before calling window.print() in the browser fallback', async () => {
    await exportAsPdf('<div><img src="https://example.com/slow.png" alt="slow"/></div>', 'Ready PDF');

    expect(capturedBlob).toBeDefined();
    const wrapper = await capturedBlob!.text();
    expect(wrapper).toContain('__odPrintReady');
    expect(wrapper).toContain('__odPrintReadyStarted');
    expect(wrapper).toContain("window.__odPrintReady===true");
    expect(wrapper).toContain("window.__odPrintReadyStarted===false");
    expect(wrapper).toContain("e.data.type==='OD_PRINT_READY'");
    expect(wrapper).toContain("e.data.type==='OD_PRINT_READY_STARTED'");
    expect(wrapper).toContain('window.addEventListener(\'message\'');
    expect(wrapper).toContain('document.fonts');
    expect(wrapper).toContain('waitForCssBackgroundImages');
    expect(wrapper).toContain("setTimeout(doPrint,300)");
    expect(wrapper).toContain('window.print()');
  });

  it('allows explicit trusted PDF opt-out without changing the secure default', async () => {
    await exportAsPdf('<main>Trusted local document</main>', 'Trusted PDF', {
      sandboxedPreview: false,
    });

    expect(openCalls).toEqual([['', '_blank']]);
    expect(mockWin.opener).toEqual({});
    expect(mockWin.location.href).toBe('blob:test');
    expect(capturedBlob).toBeDefined();
    const doc = await capturedBlob!.text();
    expect(doc).not.toContain('sandbox="allow-scripts allow-modals"');
    expect(doc).toContain('<main>Trusted local document</main>');
    expect(doc).toContain('__odPrintReady');
    expect(doc).toContain("window.__odPrintReady===true");
  });

  it('shows an alert and revokes the blob URL when the popup is blocked', async () => {
    vi.stubGlobal('window', {
      open: () => null,
      addEventListener: () => {},
    });

    const revokeSpy = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
    revokeSpy.mockClear();

    await exportAsPdf('<p>test</p>', 'Blocked');

    expect(alert).toHaveBeenCalledWith('Popup blocked! Click the popup-blocked icon in your browser address bar (or browser menu), choose "Always allow pop-ups" for this site, then retry Export PDF.');
    expect(revokeSpy).toHaveBeenCalledWith('blob:test');
  });


});

// ---------------------------------------------------------------------------
// Image screenshot export
// ---------------------------------------------------------------------------

describe('requestPreviewSnapshot', () => {
  let listeners: Map<string, Set<(ev: unknown) => void>>;

  beforeEach(() => {
    listeners = new Map();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent: (ev: { type: string }) => {
        for (const fn of listeners.get(ev.type) ?? []) fn(ev);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null when the iframe has no contentWindow', async () => {
    const iframe = { contentWindow: null } as unknown as HTMLIFrameElement;
    const result = await requestPreviewSnapshot(iframe);
    expect(result).toBeNull();
  });

  it('resolves with snapshot data when the bridge responds', async () => {
    const postMessageMock = vi.fn();
    const contentWindow = { postMessage: postMessageMock };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe);

    expect(postMessageMock).toHaveBeenCalledOnce();
    const { id } = postMessageMock.mock.calls[0]![0] as { type: string; id: string };

    // Simulate the bridge responding — source must match iframe.contentWindow
    window.dispatchEvent(
      { type: 'message', source: contentWindow, data: { type: 'od:snapshot:result', id, dataUrl: 'data:image/png;base64,abc', w: 100, h: 50 } } as unknown as Event,
    );

    const result = await promise;
    expect(result).toEqual({ dataUrl: 'data:image/png;base64,abc', w: 100, h: 50 });
  });

  it('can request a full-document snapshot from the bridge', async () => {
    const postMessageMock = vi.fn();
    const contentWindow = { postMessage: postMessageMock };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe, 100, { full: true });

    expect(postMessageMock).toHaveBeenCalledOnce();
    const message = postMessageMock.mock.calls[0]![0] as { type: string; id: string; full?: boolean };
    expect(message).toMatchObject({ type: 'od:snapshot', full: true });

    window.dispatchEvent(
      { type: 'message', source: contentWindow, data: { type: 'od:snapshot:result', id: message.id, dataUrl: 'data:image/png;base64,abc', w: 100, h: 200 } } as unknown as Event,
    );

    const result = await promise;
    expect(result).toEqual({ dataUrl: 'data:image/png;base64,abc', w: 100, h: 200 });
  });

  it('resolves null when the bridge responds with an error', async () => {
    const postMessageMock = vi.fn();
    const contentWindow = { postMessage: postMessageMock };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe);
    const { id } = postMessageMock.mock.calls[0]![0] as { type: string; id: string };

    window.dispatchEvent(
      { type: 'message', source: contentWindow, data: { type: 'od:snapshot:result', id, error: 'snapshot image failed' } } as unknown as Event,
    );

    const result = await promise;
    expect(result).toBeNull();
  });

  it('resolves null on timeout', async () => {
    vi.useFakeTimers();
    const iframe = {
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe, 100);
    vi.advanceTimersByTime(150);

    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it('ignores messages with a mismatched id', async () => {
    vi.useFakeTimers();
    const postMessageMock = vi.fn();
    const contentWindow = { postMessage: postMessageMock };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe, 100);

    // Correct source but wrong id — should be ignored
    window.dispatchEvent(
      { type: 'message', source: contentWindow, data: { type: 'od:snapshot:result', id: 'wrong-id', dataUrl: 'data:image/png;base64,abc', w: 100, h: 50 } } as unknown as Event,
    );

    vi.advanceTimersByTime(150);
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it('ignores messages from a different source window', async () => {
    vi.useFakeTimers();
    const postMessageMock = vi.fn();
    const contentWindow = { postMessage: postMessageMock };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;

    const promise = requestPreviewSnapshot(iframe, 100);
    const { id } = postMessageMock.mock.calls[0]![0] as { type: string; id: string };

    // Correct id but wrong source — should be ignored
    window.dispatchEvent(
      { type: 'message', source: { other: true }, data: { type: 'od:snapshot:result', id, dataUrl: 'data:image/png;base64,abc', w: 100, h: 50 } } as unknown as Event,
    );

    vi.advanceTimersByTime(150);
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });
});

describe('exportAsImage', () => {
  let clickMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let anchors: Array<{ href: string; download: string; click: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    clickMock = vi.fn();
    createObjectURLMock = vi.fn(() => 'blob:mock-url');
    anchors = [];
    vi.stubGlobal('URL', { createObjectURL: createObjectURLMock, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      createElement: () => {
        const el = { href: '', download: '', click: clickMock };
        anchors.push(el);
        return el;
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });
    // triggerDownload calls setTimeout for deferred revoke
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('triggers a download with a .png filename', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    exportAsImage(dataUrl, 'My Design');

    expect(clickMock).toHaveBeenCalledOnce();
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.download).toBe('My-Design.png');
  });

  it('sanitizes the title into a safe filename', () => {
    exportAsImage('data:image/png;base64,AA==', 'Hello <World> / Test!');

    expect(anchors[0]!.download).toBe('Hello-World-Test.png');
  });

  it('does not download an empty image snapshot', () => {
    expect(() => exportAsImage('data:image/png;base64,', 'Empty')).toThrow('Image snapshot is empty');

    expect(clickMock).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(0);
  });

  it('downloads a validated image data URL without creating a blob URL', () => {
    const dataUrl = 'data:image/png;base64,AA==';

    downloadImageDataUrl(dataUrl, 'workspace.png');

    expect(clickMock).toHaveBeenCalledOnce();
    expect(createObjectURLMock).not.toHaveBeenCalled();
    expect(anchors[0]!.href).toBe(dataUrl);
    expect(anchors[0]!.download).toBe('workspace.png');
  });

  it('does not download an empty image data URL', () => {
    expect(() => downloadImageDataUrl('data:image/png;base64,', 'workspace.png')).toThrow('Image snapshot is empty');

    expect(clickMock).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(0);
  });

  it('falls back to download when the native save picker is blocked', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(
      new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError'),
    );
    vi.stubGlobal('window', { showSaveFilePicker });

    const target = await prepareImageExportTarget('My Design', 'jpeg');

    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(target?.method).toBe('download');
    expect(target?.filename).toBe('My-Design.jpg');

    await target?.save(new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(clickMock).toHaveBeenCalledOnce();
    expect(anchors[0]!.download).toBe('My-Design.jpg');
  });

  it('falls back to download when the native save picker reports a cross-realm SecurityError', async () => {
    const securityError = Object.assign(new Error('Must be handling a user gesture to show a file picker.'), {
      name: 'SecurityError',
    });
    const showSaveFilePicker = vi.fn().mockRejectedValue(securityError);
    vi.stubGlobal('window', { showSaveFilePicker });

    const target = await prepareImageExportTarget('My Design', 'webp');

    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(target?.method).toBe('download');
    expect(target?.filename).toBe('My-Design.webp');
  });

  it('can skip the native save picker to avoid pre-creating empty files', async () => {
    const showSaveFilePicker = vi.fn();
    vi.stubGlobal('window', { showSaveFilePicker });

    const target = await prepareImageExportTarget('My Design', 'png', { useNativePicker: false });

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(target?.method).toBe('download');
    expect(target?.filename).toBe('My-Design.png');
  });
});
