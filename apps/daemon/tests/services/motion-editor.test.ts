import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { afterEach, describe, expect, it } from 'vitest';
import { motionEditorDocumentSchema, type MotionEditorDocument } from '@open-design/contracts';
import { readMotionExportSpec } from '../../src/artifacts/motion-delivery.js';
import { inspectMotionEditorSource, motionEditorRevision, renderMotionEditorDocument, saveMotionEditorDocument } from '../../src/services/motion-editor.js';

const document: MotionEditorDocument = {
  schemaVersion: 1, width: 960, height: 540, duration: 5, fps: 30, background: '#f4f4f4',
  objects: [{ id: 'headline', name: 'Headline', type: 'text', text: 'Hello\nworld', x: 30, y: 20, width: 400, height: 150,
    fontSize: 48, color: '#111111', fill: '#ffffff', rotation: 0, opacity: 0.8,
    animation: { preset: 'rise', start: 1, duration: 0.5, easing: 'gentle' } }],
};
let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });

describe('controlled Motion authoring', () => {
  it('requires an exact renderer match and rejects altered runtime or stray source', () => {
    const source = renderMotionEditorDocument(document);
    expect(inspectMotionEditorSource(source)).toMatchObject({ supported: true, document });
    expect(source).toContain('data-composition-id="main" data-start="0"');
    expect(source).toContain('<section id="scene-main" class="clip"');
    expect(source).not.toContain('function fit');
    expect(source).not.toContain('tl.play(');
    expect(inspectMotionEditorSource(source + '<script>bad()</script>').supported).toBe(false);
    expect(inspectMotionEditorSource(source.replace('from.y=40', 'from.y=400')).supported).toBe(false);
    expect(inspectMotionEditorSource('<h1>Old motion</h1>').supported).toBe(false);
  });

  it('validates unique identity, scene bounds, finite values and safe local images', () => {
    expect(motionEditorDocumentSchema.safeParse({ ...document, objects: [document.objects[0], document.objects[0]] }).success).toBe(false);
    for (const patch of [
      { x: Infinity }, { animation: { ...document.objects[0]!.animation, start: 5 } },
      { type: 'image', src: '../private.png' }, { type: 'image', src: 'https://example.com/a.png' },
    ]) expect(motionEditorDocumentSchema.safeParse({ ...document, objects: [{ ...document.objects[0], ...patch }] }).success).toBe(false);
  });

  it('escapes malicious text and produces a full-length deterministic GSAP timeline', async () => {
    const unsafe = { ...document, objects: [{ ...document.objects[0]!, text: '</script><img src=x onerror=bad()>' }] };
    const source = renderMotionEditorDocument(unsafe);
    const dom = new JSDOM(source, { runScripts: 'outside-only', pretendToBeVisual: true });
    const require = createRequire(import.meta.url);
    dom.window.eval(await readFile(require.resolve('gsap/dist/gsap.min.js'), 'utf8'));
    dom.window.eval(dom.window.document.querySelectorAll('script')[2]!.textContent!);
    const runtime = dom.window as unknown as { __timelines: { main: { pause(): void; totalTime(time: number): void; duration(): number; repeat(): number; timeScale(): number; paused(): boolean } } };
    const timeline = runtime.__timelines.main;
    expect(timeline.paused()).toBe(true);
    timeline.pause();
    expect(timeline.duration()).toBe(5); expect(timeline.repeat()).toBe(0); expect(timeline.timeScale()).toBe(1);
    const entrance = dom.window.document.getElementById('animation-headline')!;
    timeline.totalTime(0.5); expect(entrance.style.opacity).toBe('0');
    timeline.totalTime(2); expect(entrance.style.opacity).toBe('1');
    expect(dom.window.document.querySelector('.content')!.textContent).toBe(unsafe.objects[0]!.text);
    expect(dom.window.document.querySelectorAll('img')).toHaveLength(0);
    timeline.totalTime(0.5); expect(entrance.style.opacity).toBe('0');
    dom.window.close();
  });

  it('saves, reopens and restores with revisions; stale and busy edits preserve source', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-motion-editor-'));
    await mkdir(path.join(root, 'project'));
    await writeFile(path.join(root, 'project/gsap.min.js'), await readFile(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js')));
    const source = renderMotionEditorDocument(document);
    await writeFile(path.join(root, 'project/index.html'), source);
    expect(await readMotionExportSpec({ projectRoot: path.join(root, 'project'), sourcePath: 'index.html', outputPath: 'motion.mp4' })).toEqual({ sourcePath: 'index.html', videoPath: 'motion.mp4', audio: 'silent' });
    const next = { ...document, objects: [{ ...document.objects[0]!, text: '修改后的标题' }] };
    const saved = await saveMotionEditorDocument(root, 'project', 'index.html', { filePath: 'index.html', baseRevision: motionEditorRevision(source), document: next }, undefined, () => false);
    expect(saved).toMatchObject({ supported: true, document: next });
    const savedSource = await readFile(path.join(root, 'project/index.html'), 'utf8');
    expect(inspectMotionEditorSource(savedSource)).toEqual(saved);
    await expect(saveMotionEditorDocument(root, 'project', 'index.html', { filePath: 'index.html', baseRevision: motionEditorRevision(source), document }, undefined, () => false)).rejects.toMatchObject({ code: 'MOTION_SOURCE_CONFLICT' });
    await expect(saveMotionEditorDocument(root, 'project', 'index.html', { filePath: 'index.html', baseRevision: motionEditorRevision(savedSource), document }, undefined, () => true)).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    expect(await readFile(path.join(root, 'project/index.html'), 'utf8')).toBe(savedSource);
    const oversized = { ...document, objects: Array.from({ length: 64 }, (_, index) => ({ ...document.objects[0]!, id: `text${index}`, text: '字'.repeat(4000) })) };
    await expect(saveMotionEditorDocument(root, 'project', 'index.html', { filePath: 'index.html', baseRevision: motionEditorRevision(savedSource), document: oversized }, undefined, () => false)).rejects.toMatchObject({ code: 'MOTION_DOCUMENT_TOO_LARGE', status: 413 });
    expect(await readFile(path.join(root, 'project/index.html'), 'utf8')).toBe(savedSource);
    const restored = await saveMotionEditorDocument(root, 'project', 'index.html', { filePath: 'index.html', baseRevision: motionEditorRevision(savedSource), document }, undefined, () => false);
    expect(restored).toMatchObject({ supported: true, source });
  });
});
