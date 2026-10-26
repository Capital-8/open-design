import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { motionSourceFingerprint } from '@open-design/contracts/api/motionStructure';
import { parseMotionStructure } from '../../src/services/motion-structure.js';

function motion(body: string, after = ''): string {
  return `<!doctype html><meta name="od-motion-output" content="video"><main data-composition-id="eco" data-duration="15" data-width="1920" data-height="1080">${body}</main>${after}`;
}

describe('static Motion structure', () => {
  it('reads five authored scenes and titles, preserving source order and untimed text', () => {
    const source = motion(Array.from({ length: 5 }, (_, index) => `<section id="scene-${index}" data-start="${index * 3}" data-duration="3"><h2>ECOTREE ${index + 1}</h2><p data-motion-role="text">Detail ${index + 1}</p></section>`).join(''));
    const structure = parseMotionStructure(source);
    expect(structure.sourceFingerprint).toBe(motionSourceFingerprint(source));
    expect(structure.composition).toEqual({ id: 'eco', duration: 15, width: 1920, height: 1080 });
    expect(structure.scenes.map((scene) => [scene.label, scene.start, scene.duration])).toEqual(
      Array.from({ length: 5 }, (_, index) => [`ECOTREE ${index + 1}`, index * 3, 3]),
    );
    expect(structure.texts).toHaveLength(10);
    expect(structure.texts[4]).toMatchObject({ text: 'ECOTREE 3', sceneId: structure.scenes[2]!.id });
    expect(structure.texts.every((item) => item.start === undefined && item.duration === undefined)).toBe(true);
    expect(structure.audio).toEqual([]);
    expect(structure.captions).toEqual([]);
  });

  it('accepts overlapping declarations, explicit captions, and document-level audio with default start', () => {
    const structure = parseMotionStructure(motion(`
      <section data-start="0" data-duration="8"><h1>First</h1><p class="subtitle">Do not infer caption</p>
        <p data-motion-role="caption" data-start="1" data-duration="2">Spoken words</p>
      </section>
      <div data-composition-id="second" data-start="5" data-duration="10"><h2>Second</h2></div>
      <div data-composition-id="external" data-composition-src="secret.html" data-start="8" data-duration="2"></div>
    `, '<audio src="voice.mp3" data-duration="15"></audio>'));
    expect(structure.scenes.map((item) => item.start)).toEqual([0, 5, 8]);
    expect(structure.audio[0]).toMatchObject({ src: 'voice.mp3', start: 0, duration: 15 });
    expect(structure.audio[0]!.selector).toBeUndefined();
    expect(structure.captions).toHaveLength(1);
    expect(structure.captions[0]).toMatchObject({ text: 'Spoken words', start: 1, duration: 2, sceneId: structure.scenes[0]!.id });
    expect(structure.texts.map((item) => item.text)).toEqual(['First', 'Second']);
  });

  it('omits bad intervals with warnings and never manufactures text timing', () => {
    const structure = parseMotionStructure(motion(`
      <section data-start="-1" data-duration="3"><h2>Invalid scene</h2></section>
      <section data-start="13" data-duration="4"></section>
      <section data-start="0" data-duration="Infinity"></section>
      <h2 data-duration="1">Untimed title</h2>
      <audio src="missing-time.mp3"></audio>
      <p data-motion-role="caption">Untimed caption</p>
      <p data-motion-role="caption" data-start="1" data-duration="0">Empty duration</p>
    `));
    expect(structure.scenes).toEqual([]);
    expect(structure.audio).toEqual([]);
    expect(structure.captions).toEqual([]);
    expect(structure.texts[1]).toMatchObject({ text: 'Untimed title' });
    expect(structure.texts[1]!.duration).toBeUndefined();
    expect(structure.warnings.length).toBeGreaterThan(0);
  });

  it('produces unique safe selectors even for duplicate and punctuation IDs', () => {
    const source = motion(`<section id="same" data-start="0" data-duration="4"><h2 id='a&quot;] > .x'>One</h2></section><section id="same" data-start="4" data-duration="4"><h2 id="same">Two</h2></section>`);
    const $ = load(source);
    const structure = parseMotionStructure(source);
    for (const item of [...structure.scenes, ...structure.texts]) {
      expect(item.selector).toBeDefined();
      expect($(item.selector!).length).toBe(1);
    }
    expect($(structure.texts[0]!.selector!).text()).toBe('One');
    expect($(structure.texts[1]!.selector!).text()).toBe('Two');
  });

  it('anchors title paths to the nearest unique ancestor so runtime stage wrappers preserve the target', () => {
    const source = motion('<section id="scene-3" data-start="5" data-duration="3"><div><h2>Built for everyday patio use.</h2></div></section>');
    const $ = load(source);
    const title = $('h2').get(0);
    const selector = parseMotionStructure(source).texts[0]!.selector!;
    expect(selector).toBe('[id="scene-3"] > div:nth-of-type(1) > h2:nth-of-type(1)');
    $('[data-composition-id="eco"]').wrap('<div data-runtime-stage style="position:fixed"></div>');
    expect($(selector).length).toBe(1);
    expect($(selector).get(0)).toBe(title);
  });

  it('skips duplicate ancestor IDs and anchors at the unique composition instead', () => {
    const source = motion('<section id="duplicate" data-start="0" data-duration="3"><div><h2>Title</h2></div></section><section id="duplicate" data-start="3" data-duration="3"></section>');
    const $ = load(source);
    const title = $('h2').get(0);
    const selector = parseMotionStructure(source).texts[0]!.selector!;
    expect(selector).toBe('[data-composition-id="eco"] > section:nth-of-type(1) > div:nth-of-type(1) > h2:nth-of-type(1)');
    $('[data-composition-id="eco"]').wrap('<div data-runtime-stage></div>');
    expect($(selector).length).toBe(1);
    expect($(selector).get(0)).toBe(title);
  });

  it('abstains from selectors for unsupported tag names and foreign namespaces', () => {
    const structure = parseMotionStructure(motion('<svg><g id="foreign" data-motion-role="text">Foreign text</g></svg><x:y id="unusual" data-motion-role="text">Unusual tag</x:y>'));
    expect(structure.texts).toHaveLength(2);
    expect(structure.texts.every((item) => item.selector === undefined)).toBe(true);
  });

  it('falls back on missing/interactive/invalid first roots and does not execute scripts', () => {
    expect(parseMotionStructure('<script>throw new Error("executed")</script>').composition).toBeNull();
    expect(parseMotionStructure(motion('<h1>Title</h1>').replace('content="video"', 'content="interactive"')).composition).toBeNull();
    const structure = parseMotionStructure(motion('<h1>Title</h1><script>throw new Error("executed")</script>'));
    expect(structure.scenes).toEqual([]);
    expect(structure.composition).not.toBeNull();
    expect(structure.texts[0]!.text).toBe('Title');
    const invalidFirst = motion('').replace('data-duration="15"', 'data-duration="0"') + motion('<section data-start="0" data-duration="2"></section>');
    expect(parseMotionStructure(invalidFirst).composition).toBeNull();
  });

  it('bounds visible structure without treating inspection truncation as a failure', () => {
    const structure = parseMotionStructure(motion(Array.from({ length: 70 }, (_, index) => `<section data-start="0" data-duration="1"><h2>${index}</h2><p data-motion-role="text">More</p></section>`).join('')));
    expect(structure.scenes).toHaveLength(64);
    expect(structure.texts).toHaveLength(128);
    expect(structure.warnings).toContain('scene declarations exceed the 64-item inspection limit.');
    expect(structure.warnings).toContain('text declarations exceed the 128-item inspection limit.');
  });

  it('does not expose inert template content as live composition or targets', () => {
    const source = `<template>${motion('<h1>Inert root</h1>')}</template>` + motion('<section data-start="0" data-duration="3"><template><h2>Inert text</h2><section data-start="0" data-duration="1"></section></template><h2>Live text</h2></section>');
    const structure = parseMotionStructure(source);
    expect(structure.scenes).toHaveLength(1);
    expect(structure.texts.map((item) => item.text)).toEqual(['Live text']);
  });
});
