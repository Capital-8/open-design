// @vitest-environment jsdom
import { pickHomeTemplate } from '../helpers/home-template-picker';
//
// Web-clone remains reachable through task selection with real catalogue states.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

// `send()` forwards a trailing request-id arg, so match on (event, props) and
// ignore any extra positional args rather than asserting exact arity.
function lastClickProps(element: string): Record<string, unknown> | undefined {
  const call = [...analyticsMocks.track.mock.calls]
    .reverse()
    .find((args) => args[0] === 'ui_click' && (args[1] as { element?: string })?.element === element);
  return call?.[1] as Record<string, unknown> | undefined;
}

vi.mock('../../src/analytics/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/analytics/provider')>();
  return {
    ...actual,
    useAnalytics: () => ({
      track: analyticsMocks.track,
      newRequestId: () => 'request-1',
      setConfigureGlobals: vi.fn(),
      setConsent: vi.fn(),
      setIdentity: vi.fn(),
    }),
  };
});

// The base scenario binds the task but has no poster, so it is not a featured template.
const WEB_CLONE_BASE = {
  id: 'example-web-clone',
  title: 'Website clone',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/web-clone',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/web-clone',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'example-web-clone',
    title: 'Website clone',
    version: '0.1.0',
    description: 'Recreate an existing website.',
    tags: ['web-clone', 'website-clone'],
    od: {
      kind: 'scenario',
      taskKind: 'new-generation',
      useCase: { query: 'Recreate the website at {{targetUrl}}.' },
    },
  },
};

function stubPlugins() {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [WEB_CLONE_BASE] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

function renderHome() {
  return render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  analyticsMocks.track.mockClear();
  cleanup();
  window.localStorage.clear();
});


describe('web-clone task discovery', () => {
  it('shows an honest empty catalogue instead of static site mockups', async () => {
    writeHomeGuideStage('done');
    stubPlugins();
    renderHome();
    await pickHomeTemplate('web-clone');
    expect(screen.queryByTestId('home-hero-prompt-example')).toBeNull();
    expect(screen.queryByTestId('home-hero-plugin-presets')).toBeNull();
    expect(screen.getByText('No templates available for this type yet. You can start with your own idea.')).toBeTruthy();
    expect(document.querySelector('[data-testid^="home-hero-plugin-preset-duplicate"]')).toBeNull();
  });

  it('tracks the web-clone task selection and keeps its composer binding', async () => {
    writeHomeGuideStage('done');
    stubPlugins();
    renderHome();
    await pickHomeTemplate('web-clone');
    await waitFor(() => expect(lastClickProps('task_chip')).toMatchObject({
      page_name: 'home', area: 'chat_composer', element: 'task_chip', chip_id: 'web-clone',
    }));
    expect(screen.getByTestId('home-hero-template-trigger').textContent).toContain('Website clone');
  });
});
