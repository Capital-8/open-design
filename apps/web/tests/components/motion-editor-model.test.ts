import { describe, expect, it } from 'vitest';
import type { MotionEditorDocument, MotionEditorObject } from '@open-design/contracts';
import { shiftMotionObjects, staggerMotionObjects } from '../../src/components/motion-editor-model';

const object = (id: string, start: number): MotionEditorObject => ({
  id, name: id, type: 'text', text: `Text ${id}`, x: 20, y: 30, width: 300, height: 80,
  fontSize: 24, color: '#ffffff', fill: '#000000', rotation: 0, opacity: 1,
  animation: { preset: 'rise', start, duration: 1, easing: 'gentle' },
});
const fixture = (): MotionEditorDocument => ({ schemaVersion: 1, width: 1280, height: 720,
  duration: 6, fps: 30, background: '#202020', objects: [object('title', .5), object('body', 1.5), object('logo', 2.5)] });

describe('Motion selection timing transactions', () => {
  it('shifts selected animations together, retaining spacing and untouched objects', () => {
    const document = fixture();
    const original = structuredClone(document);
    const next = shiftMotionObjects(document, ['title', 'body'], .25);
    expect(next.objects.map(item => item.animation.start)).toEqual([.75, 1.75, 2.5]);
    expect(next.objects.map(item => item.animation.duration)).toEqual([1, 1, 1]);
    expect(next.objects[2]).toEqual(document.objects[2]);
    expect(document).toEqual(original);
  });

  it.each([-.6, 4, NaN, Infinity])('rejects a whole shift when any selected timing is invalid: %s', delta => {
    const document = fixture();
    const original = structuredClone(document);
    expect(() => shiftMotionObjects(document, ['title', 'body'], delta)).toThrow();
    expect(document).toEqual(original);
  });

  it.each([{ ids: [] }, { ids: ['missing'] }, { ids: ['title', 'missing'] }, { ids: ['title', 'title'] }])('rejects an invalid shift selection $ids', ({ ids }) => {
    expect(() => shiftMotionObjects(fixture(), ids, .25)).toThrow();
  });

  it('staggers by explicit selection order, retaining all other properties and unselected objects', () => {
    const document = fixture();
    const original = structuredClone(document);
    const next = staggerMotionObjects(document, ['logo', 'title'], .2);
    expect(next.objects.map(item => item.animation.start)).toEqual([2.7, 1.5, 2.5]);
    expect(next.objects[1]).toEqual(document.objects[1]);
    expect(next.objects[0]).toEqual({ ...document.objects[0], animation: { ...document.objects[0]!.animation, start: 2.7 } });
    expect(document).toEqual(original);
  });

  it('rejects an out-of-range stagger atomically rather than clipping or changing a subset', () => {
    const document = fixture();
    const original = structuredClone(document);
    expect(() => staggerMotionObjects(document, ['logo', 'title', 'body'], 2)).toThrow();
    expect(document).toEqual(original);
  });

  it.each([
    { ids: ['title'], interval: .2 }, { ids: ['title', 'title'], interval: .2 },
    { ids: ['title', 'missing'], interval: .2 }, { ids: ['title', 'body'], interval: -.1 },
    { ids: ['title', 'body'], interval: NaN }, { ids: ['title', 'body'], interval: Infinity },
  ])('rejects invalid stagger input $ids / $interval', ({ ids, interval }) => {
    expect(() => staggerMotionObjects(fixture(), ids, interval)).toThrow();
  });
});
