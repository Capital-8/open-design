// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { HomeStartPanel, type HomeFeaturedTemplate } from '../../../src/components/home-hero/HomeStartPanel';
import { orderedCreateChips } from '../../../src/components/home-hero/chips';

afterEach(cleanup);
const chips = orderedCreateChips();
const record = { id: 'real-template', title: 'Real template' } as InstalledPluginRecord;
const template: HomeFeaturedTemplate = { record, chipId: 'prototype', title: 'Real template', poster: '/actual-poster.webp', prompt: 'Build my template' };
const props = () => ({ chips, activeChipId: null, activePluginId: null,
  templates: [template], loading: false, loadFailed: false, disabled: false,
  availablePluginIds: new Set(chips.flatMap((chip) => chip.action.kind === 'apply-scenario' ? [chip.action.pluginId] : [])),
  labelFor: (id: string) => id, descriptionFor: (id: string) => `${id} description`,
  onPickChip: vi.fn(), onPreview: vi.fn(), onUse: vi.fn(), onBrowseTemplates: vi.fn(), onRetry: vi.fn(),
});

describe('HomeStartPanel', () => {
  it('keeps two featured types and reaches every other type through small entries or More', () => {
    const p = props(); render(<HomeStartPanel {...p} />);
    fireEvent.click(screen.getByTestId('home-hero-rail-motion-design'));
    expect(p.onPickChip).toHaveBeenCalledWith(expect.objectContaining({ id: 'motion-design' }));
    fireEvent.click(screen.getByTestId('home-start-more'));
    for (const chip of chips) expect(screen.getByTestId(`home-hero-rail-${chip.id}`)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('home-hero-rail-audio')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('home-start-more'));
  });
  it('keeps the portalled More actions usable and closes after a pick', () => {
    const p = props(); render(<HomeStartPanel {...p} />);
    fireEvent.click(screen.getByTestId('home-start-more'));
    const audio = screen.getByTestId('home-hero-rail-audio');
    expect(screen.getByTestId('home-start-panel').contains(audio)).toBe(false);
    fireEvent.pointerDown(audio);
    expect(screen.getByTestId('home-hero-rail-audio')).toBeTruthy();
    fireEvent.click(audio);
    expect(p.onPickChip).toHaveBeenCalledWith(expect.objectContaining({ id: 'audio' }));
    expect(screen.queryByTestId('home-hero-rail-audio')).toBeNull();
  });
  it('separates preview, use and the full catalogue, and never shows more than two cards', () => {
    const p = props(); render(<HomeStartPanel {...p} templates={[template, { ...template, record: { ...record, id: 'two' }, title: 'Second' }, { ...template, record: { ...record, id: 'three' }, title: 'Third' }]} />);
    expect(screen.getAllByTestId('home-hero-plugin-preset')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Preview: Real template' }));
    expect(p.onPreview).toHaveBeenCalledWith(record); expect(p.onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use: Real template' }));
    expect(p.onUse).toHaveBeenCalledWith(record, 'prototype', template.prompt);
    fireEvent.click(screen.getByRole('button', { name: 'All templates' }));
    expect(p.onBrowseTemplates).toHaveBeenCalledOnce();
  });
  it('distinguishes loading, a failed read and an empty catalogue without invented examples', () => {
    const p = props(); const { rerender } = render(<HomeStartPanel {...p} loading />);
    expect(screen.getByRole('status')).toBeTruthy(); expect(screen.queryByTestId('home-hero-plugin-preset')).toBeNull();
    rerender(<HomeStartPanel {...p} templates={[]} loadFailed />);
    expect(screen.getByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(p.onRetry).toHaveBeenCalledOnce();
    rerender(<HomeStartPanel {...p} templates={[]} />);
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText(/No templates available/)).toBeTruthy();
    expect(screen.queryByTestId('home-hero-plugin-preset')).toBeNull();
  });
  it('disables unavailable task resources instead of presenting dead actions', () => {
    const p = props(); render(<HomeStartPanel {...p} availablePluginIds={new Set()} />);
    fireEvent.click(screen.getByTestId('home-hero-rail-prototype')); expect(p.onPickChip).not.toHaveBeenCalled();
  });
});
