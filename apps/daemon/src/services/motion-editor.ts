import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { motionEditorDocumentSchema, type MotionEditorDocument, type MotionEditorResponse, type MotionEditorSaveRequest, type MotionEditorPreviewRequest, type MotionEditorPreviewResponse, type ProjectMetadata } from '@open-design/contracts';
import { readProjectFile, writeProjectFile } from '../projects.js';
import { readProjectFileVersion, withProjectFileVersionLock } from '../project-file-versions.js';
import { normalizeArtifactRuntimeImports } from '../artifacts/runtime-compat.js';

const DATA_OPEN = '<script id="od-motion-editor-document" type="application/json">';
const DATA_CLOSE = '</script>';
export const MOTION_EDITOR_MAX_BYTES = 1024 * 1024;
export class MotionEditorError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const jsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e').replace(/&/gu, '\\u0026');
export const motionEditorRevision = (source: string) => createHash('sha256').update(source).digest('hex');

/** A deliberately narrow, deterministic GSAP authoring adapter. No source inference. */
export function renderMotionEditorDocument(input: MotionEditorDocument): string {
  const doc = motionEditorDocumentSchema.parse(input);
  const objects = doc.objects.map(object => {
    const content = object.type === 'text' ? escapeHtml(object.text ?? '')
      : object.type === 'image' ? `<img src="${escapeHtml(object.src!)}" alt="${escapeHtml(object.name)}">` : '';
    return `<div id="object-${object.id}" data-od-motion-object="${object.id}" data-label="${escapeHtml(object.name)}" style="left:${object.x}px;top:${object.y}px;width:${object.width}px;height:${object.height}px;transform:rotate(${object.rotation}deg);opacity:${object.opacity}"><div class="entrance" id="animation-${object.id}"><div class="content ${object.type}"${object.type === 'text' ? ' data-motion-role="text"' : ''} style="font-size:${object.fontSize}px;color:${object.color};${object.type === 'shape' ? `background:${object.fill};` : ''}">${content}</div></div></div>`;
  }).join('\n');
  const source = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="od-motion-output" content="video"><meta name="od-motion-editor" content="1"><link rel="alternate" type="video/mp4" href="./motion.mp4"><title>Motion composition</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${doc.background}}body{display:flex;align-items:center;justify-content:center}#main{position:relative;flex:none;width:${doc.width}px;height:${doc.height}px;overflow:hidden;transform-origin:center;background:${doc.background}}[data-od-motion-object]{position:absolute;box-sizing:border-box}.entrance,.content{width:100%;height:100%;box-sizing:border-box}.content.text{font-family:Arial,"Noto Sans",sans-serif;font-weight:600;line-height:1.12;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere}.content.shape{border-radius:16px}.content img{width:100%;height:100%;object-fit:contain;display:block}</style>
<script src="./gsap.min.js"></script></head><body>
<main id="main" data-composition-id="main" data-start="0" data-width="${doc.width}" data-height="${doc.height}" data-duration="${doc.duration}" data-fps="${doc.fps}"><section id="scene-main" class="clip" data-start="0" data-duration="${doc.duration}" data-label="Main scene">${objects}</section></main>
${DATA_OPEN}${jsonForHtml(doc)}${DATA_CLOSE}
<script>
(function(){
  var doc=JSON.parse(document.getElementById('od-motion-editor-document').textContent);
  var stage=document.getElementById('main');
  if(!window.gsap){stage.textContent='The local gsap.min.js asset is missing.';return;}
  var tl=gsap.timeline({paused:true});
  var easing={linear:'none',gentle:'power2.out',snappy:'power3.out'};
  doc.objects.forEach(function(object){
    var animation=object.animation;var target=document.getElementById('animation-'+object.id);
    var from={opacity:0,x:0,y:0,scale:1};
    if(animation.preset==='rise')from.y=40;
    if(animation.preset==='slide')from.x=-48;
    if(animation.preset==='scale')from.scale=0.8;
    gsap.set(target,from);
    tl.fromTo(target,from,{opacity:1,x:0,y:0,scale:1,duration:animation.duration,ease:easing[animation.easing],immediateRender:false},animation.start);
  });
  tl.to({value:0},{value:1,duration:doc.duration,ease:'none'},0);
  window.__timelines=window.__timelines||{};window.__timelines.main=tl;
  stage.addEventListener('click',function(event){var target=event.target.closest('[data-od-motion-object]');if(target&&window.parent!==window)window.parent.postMessage({type:'od-motion-editor-select',id:target.getAttribute('data-od-motion-object')},'*');});
})();
</script></body></html>\n`;
  if (Buffer.byteLength(source, 'utf8') > MOTION_EDITOR_MAX_BYTES) throw new MotionEditorError('MOTION_DOCUMENT_TOO_LARGE', 'The rendered composition exceeds the 1 MiB editing limit. Reduce its content before saving.', 413);
  return source;
}

export function inspectMotionEditorSource(source: string): MotionEditorResponse {
  if (Buffer.byteLength(source, 'utf8') > MOTION_EDITOR_MAX_BYTES) return { supported: false, reason: 'Motion source exceeds the editable size limit.' };
  const start = source.indexOf(DATA_OPEN);
  if (start < 0) return { supported: false, reason: 'This composition uses free-form animation code. Use AI to edit it.' };
  try {
    const end = source.indexOf(DATA_CLOSE, start + DATA_OPEN.length);
    const doc = motionEditorDocumentSchema.parse(JSON.parse(source.slice(start + DATA_OPEN.length, end)));
    if (renderMotionEditorDocument(doc) !== source) return { supported: false, reason: 'The composition code has changed outside the supported editor. Use AI or restore a compatible version.' };
    return { supported: true, document: doc, source, revision: motionEditorRevision(source) };
  } catch { return { supported: false, reason: 'The editable document is invalid. Use AI to repair it.' }; }
}

/** The generated source delegates animation only to this known local GSAP build. */
export async function verifyMotionEditorRuntime(projectsRoot: string, projectId: string, filePath: string, metadata?: ProjectMetadata): Promise<boolean> {
  try {
    const relativeAsset = path.posix.join(path.posix.dirname(filePath.replace(/\\/gu, '/')), 'gsap.min.js');
    const [asset, expected] = await Promise.all([
      readProjectFile(projectsRoot, projectId, relativeAsset, metadata),
      readFile(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js')),
    ]);
    return asset.buffer.equals(expected);
  } catch { return false; }
}

/** Render a candidate without writing any file or creating a history entry. */
export async function previewMotionEditorDocument(projectsRoot: string, projectId: string, filePath: string,
  request: MotionEditorPreviewRequest, metadata?: ProjectMetadata): Promise<MotionEditorPreviewResponse> {
  if (!/^[a-f0-9]{64}$/u.test(request.baseRevision ?? '')) throw new MotionEditorError('BAD_REQUEST', 'A source revision is required.', 400);
  const parsed = motionEditorDocumentSchema.safeParse(request.document);
  if (!parsed.success) throw new MotionEditorError('BAD_REQUEST', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
  const file = await readProjectFile(projectsRoot, projectId, filePath, metadata);
  const currentSource = file.buffer.toString('utf8');
  if (motionEditorRevision(currentSource) !== request.baseRevision) throw new MotionEditorError('MOTION_SOURCE_CONFLICT', 'The source changed. Reload before editing.');
  if (!inspectMotionEditorSource(currentSource).supported) throw new MotionEditorError('MOTION_UNSUPPORTED', 'This source no longer supports direct editing.');
  if (!await verifyMotionEditorRuntime(projectsRoot, projectId, filePath, metadata)) throw new MotionEditorError('MOTION_RUNTIME_UNSUPPORTED', 'The composition requires the supported local GSAP runtime.');
  return { source: renderMotionEditorDocument(parsed.data) };
}

/** Shares the existing version lock. External OS writes cannot be excluded; never roll them back. */
export async function saveMotionEditorDocument(projectsRoot: string, projectId: string, filePath: string,
  request: MotionEditorSaveRequest, metadata: ProjectMetadata | undefined, editingBusy: () => boolean): Promise<MotionEditorResponse> {
  if (editingBusy()) throw new MotionEditorError('PROJECT_BUSY', 'Wait for generation to finish before editing.');
  if (!/^[a-f0-9]{64}$/u.test(request.baseRevision ?? '')) throw new MotionEditorError('BAD_REQUEST', 'A source revision is required.', 400);
  const parsed = motionEditorDocumentSchema.safeParse(request.document);
  if (!parsed.success) throw new MotionEditorError('BAD_REQUEST', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
  if (!await verifyMotionEditorRuntime(projectsRoot, projectId, filePath, metadata)) throw new MotionEditorError('MOTION_RUNTIME_UNSUPPORTED', 'The composition requires the supported local GSAP runtime.');
  const initial = await readProjectFile(projectsRoot, projectId, filePath, metadata);
  return withProjectFileVersionLock(projectsRoot, projectId, initial.name, metadata, async lock => {
    const read = () => readProjectFile(projectsRoot, projectId, initial.name, metadata);
    const current = await read();
    const currentSource = current.buffer.toString('utf8');
    if (editingBusy() || motionEditorRevision(currentSource) !== request.baseRevision) throw new MotionEditorError('MOTION_SOURCE_CONFLICT', 'The source changed. Reload before editing.');
    if (!inspectMotionEditorSource(currentSource).supported) throw new MotionEditorError('MOTION_UNSUPPORTED', 'This source no longer supports direct editing.');
    const source = renderMotionEditorDocument(parsed.data);
    const bytes = Buffer.from(source, 'utf8');
    const normalized = normalizeArtifactRuntimeImports(initial.name, bytes);
    if (!Buffer.isBuffer(normalized) || !normalized.equals(bytes)) throw new MotionEditorError('MOTION_SOURCE_NORMALIZATION_REQUIRED', 'Runtime import normalization is required before editing.');
    if (source === currentSource) return inspectMotionEditorSource(source);
    const baseline = await lock.ensureCurrentVersion(currentSource, { source: 'manual', promptSource: 'manual', label: 'Before motion edit' });
    if (!baseline || (await readProjectFileVersion(projectsRoot, projectId, initial.name, baseline.id, metadata)).content !== currentSource) {
      throw new MotionEditorError('MOTION_VERSION_UNCONFIRMED', 'The original version could not be confirmed. No edit was saved.', 500);
    }
    if (editingBusy() || !await verifyMotionEditorRuntime(projectsRoot, projectId, initial.name, metadata) || !(await read()).buffer.equals(current.buffer)) throw new MotionEditorError('MOTION_SOURCE_CONFLICT', 'The source changed while preparing the edit.');
    await writeProjectFile(projectsRoot, projectId, initial.name, bytes, {}, metadata);
    if (!(await read()).buffer.equals(bytes)) throw new MotionEditorError('MOTION_SOURCE_CONFLICT', 'Source readback differs. Reload; no rollback was attempted.');
    try {
      const version = await lock.ensureCurrentVersion(source, { source: 'manual', promptSource: 'manual', label: request.label?.slice(0, 120) || 'Edit motion' });
      if (!version || (await readProjectFileVersion(projectsRoot, projectId, initial.name, version.id, metadata)).content !== source) throw new Error('Version readback differs');
    } catch { throw new MotionEditorError('MOTION_VERSION_UNCONFIRMED', 'The source was saved, but its history could not be confirmed. Reload before retrying.', 500); }
    if (!(await read()).buffer.equals(bytes)) throw new MotionEditorError('MOTION_SOURCE_CONFLICT', 'Source changed after save. Reload; no rollback was attempted.');
    return inspectMotionEditorSource(source);
  });
}
