// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../../src/components/HomeView';
import { homeHeroPromptText, setHomeHeroPrompt } from '../helpers/home-hero-lexical';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({ PlaceholderCarousel: () => null }));
vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>(),
  useWorkspaceContext: () => ({ context: null, loading: false, failure: 'unsupported' as const }),
}));
function plugin(id: string, title: string, tags: string[]) {
  return { id, title, version: '0.1.0', trust: 'bundled', sourceKind: 'bundled', source: `/test/${id}`,
    capabilitiesGranted: ['prompt:inject'], fsPath: `/test/${id}`, installedAt: 0, updatedAt: 0,
    manifest: { name: id, title, version: '0.1.0', description: title, tags,
      od: { kind: 'scenario', taskKind: 'new-generation', useCase: { query: `Create ${title}.` },
        preview: { type: 'image', poster: `/test/${id}.webp` } } } };
}
const catalog = [plugin('example-web-prototype', 'Prototype starter', ['prototype']),
  plugin('od-new-generation', 'New generation', []),
  plugin('example-frame-glitch-title', 'Motion starter', ['motion-design'])];
function setup() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => new Response(
    JSON.stringify(input === '/api/plugins' ? { plugins: catalog } : {}), { status: 200, headers: { 'content-type': 'application/json' } },
  )));
  return render(<HomeView projects={[]} onSubmit={vi.fn()} onOpenProject={vi.fn()} onBrowseTemplates={vi.fn()} />);
}
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('Home redesign composer integration', () => {
  it('starts unselected, keeps user text and attachments through task selection and clearing', async () => {
    setup();
    await waitFor(() => expect((screen.getByTestId('home-hero-rail-prototype') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId('home-hero-template-picker').getAttribute('data-type')).toBeNull();
    setHomeHeroPrompt('Keep my existing idea');
    fireEvent.change(screen.getByTestId('home-hero-file-input'), { target: { files: [new File(['notes'], 'brief.txt')] } });
    fireEvent.click(screen.getByTestId('home-hero-rail-motion-design'));
    await waitFor(() => expect(screen.getByTestId('home-hero-template-picker').getAttribute('data-type')).toBe('motion-design'));
    expect(homeHeroPromptText()).toBe('Keep my existing idea');
    const picker = screen.getByTestId('home-hero-template-picker');
    fireEvent.click(within(picker).getByRole('button', { name: /Remove/ }));
    expect(picker.getAttribute('data-type')).toBeNull(); expect(homeHeroPromptText()).toBe('Keep my existing idea');
    expect(screen.getByTestId('home-hero-staged-files').textContent).toContain('brief.txt');
  });
  it('asks before replacing an edited prompt with a template; cancellation keeps the draft and attachments', async () => {
    setup();
    await screen.findByTestId('home-hero-plugin-presets');
    setHomeHeroPrompt('My carefully edited brief');
    fireEvent.change(screen.getByTestId('home-hero-file-input'), { target: { files: [new File(['notes'], 'brief.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Prototype starter' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(homeHeroPromptText()).toBe('My carefully edited brief');
    expect(screen.getByTestId('home-hero-staged-files').textContent).toContain('brief.txt');
    expect(screen.getByTestId('home-hero-template-picker').getAttribute('data-type')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Prototype starter' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Replace/ }));
    await waitFor(() => expect(homeHeroPromptText()).toBe('Prototype starter'));
    expect(screen.getByTestId('home-hero-template-picker').getAttribute('data-type')).toBe('prototype');
    expect(screen.getByTestId('home-hero-staged-files').textContent).toContain('brief.txt');
  });
});
