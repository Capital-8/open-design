import { load, type CheerioAPI } from 'cheerio';
import {
  motionSourceFingerprint,
  type MotionStructureItem,
  type MotionStructureResponse,
} from '@open-design/contracts/api/motionStructure';

export const MOTION_STRUCTURE_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SCENES = 64;
const MAX_CONTENT_ITEMS = 128;
type CheerioNode = ReturnType<CheerioAPI> extends ArrayLike<infer N> ? N : never;
type Element = Extract<CheerioNode, { attribs: Record<string, string> }>;

function isLiveElement($: CheerioAPI, node: Element): boolean {
  // parse5 stores template contents in a detached document fragment; Cheerio's
  // normal ancestors stop at that fragment, as browser selectors do.
  return (node.name === 'html' || $(node).parents('html').length > 0)
    && $(node).parents('template, script, style, noscript').length === 0;
}

function finiteAttribute(value: string | undefined): number | null {
  if (value === undefined || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function attributeValue(value: string): string {
  return value.replace(/[\\"\u0000-\u001f\u007f]/gu, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
}

/** Anchor paths within authored identity so runtime wrappers cannot invalidate them. */
function uniqueSelector($: CheerioAPI, node: Element): string | undefined {
  const parts: string[] = [];
  let current: Element | null = node;
  const selectsTarget = (selector: string) => {
    const matches = $(selector);
    return matches.length === 1 && matches.get(0) === node;
  };
  while (current) {
    // Only HTML tag names form path selectors. Exotic author namespaces abstain.
    if (!/^[a-z][a-z0-9-]*$/u.test(current.name) || current.namespace !== 'http://www.w3.org/1999/xhtml') return undefined;
    for (const name of ['id', 'data-composition-id']) {
      const value = $(current).attr(name);
      if (!value) continue;
      const anchor = `[${name}="${attributeValue(value)}"]`;
      if ($(anchor).length !== 1) continue;
      const selector = [anchor, ...parts].join(' > ');
      if (selectsTarget(selector)) return selector;
    }
    if (current.name === 'body') {
      const selector = ['body', ...parts].join(' > ');
      return selectsTarget(selector) ? selector : undefined;
    }
    const siblings = $(current).parent().children(current.name).toArray();
    const position = siblings.indexOf(current);
    if (position < 0) return undefined;
    parts.unshift(`${current.name}:nth-of-type(${position + 1})`);
    const parent: CheerioNode | null = current.parent;
    current = parent && parent.type === 'tag' ? parent as Element : null;
  }
  return undefined;
}

function compactText($: CheerioAPI, node: Element): string {
  return $(node).clone().find('script, style, template').remove().end().text().replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function labelFor($: CheerioAPI, node: Element, fallback: string): string {
  const element = $(node);
  const heading = element.find('h1, h2, h3').filter((_, child) => isLiveElement($, child)).get(0);
  return (element.attr('data-label') || element.attr('data-name') || element.attr('aria-label')
    || element.attr('title') || (heading ? compactText($, heading) : '')
    || element.attr('data-composition-id') || element.attr('id') || fallback).slice(0, 120);
}

/** Parse declarations only. Author scripts, assets and external compositions are never read. */
export function parseMotionStructure(source: string): MotionStructureResponse {
  const result: MotionStructureResponse = {
    sourceFingerprint: motionSourceFingerprint(source),
    composition: null,
    scenes: [], texts: [], audio: [], captions: [], warnings: [],
  };
  const warn = (message: string) => {
    if (!result.warnings.includes(message) && result.warnings.length < 32) result.warnings.push(message);
  };
  const $ = load(source);
  const inspectable = (node: Element) => isLiveElement($, node);
  if ($('meta[name="od-motion-output"]').filter((_, node) => inspectable(node)).first().attr('content') !== 'video') {
    warn('Canonical Motion video declaration is missing.');
    return result;
  }
  // Match the existing source player's first canonical root, including an invalid first root.
  const roots = $('[data-composition-id][data-duration][data-width][data-height]').filter((_, node) => inspectable(node));
  const root = roots.first();
  const rootNode = root.get(0);
  const duration = finiteAttribute(root.attr('data-duration'));
  const width = finiteAttribute(root.attr('data-width'));
  const height = finiteAttribute(root.attr('data-height'));
  const id = root.attr('data-composition-id')?.trim();
  if (!rootNode || !id || duration === null || duration <= 0 || width === null || width <= 0 || height === null || height <= 0) {
    warn('Canonical Motion root has invalid id, duration or dimensions.');
    return result;
  }
  result.composition = { id, duration, width, height };
  const compositionDuration = duration;
  const rootDescendants = new Set(root.find('*').toArray());
  if (roots.filter((_, node) => !rootDescendants.has(node)).length > 1) {
    warn('Only the first canonical Motion root is inspected.');
  }

  function interval(node: Element, description: string, defaultStart?: number): { start: number; duration: number } | null {
    const element = $(node);
    const start = element.attr('data-start') === undefined ? defaultStart ?? null : finiteAttribute(element.attr('data-start'));
    const itemDuration = finiteAttribute(element.attr('data-duration'));
    const precision = Number.EPSILON * Math.max(1, compositionDuration) * 8;
    if (start === null || itemDuration === null || start < 0 || itemDuration <= 0 || start >= compositionDuration || start + itemDuration > compositionDuration + precision) {
      warn(`${description}: invalid or out-of-range timing was omitted.`);
      return null;
    }
    return { start, duration: itemDuration };
  }
  function locator(node: Element): Pick<MotionStructureItem, 'selector'> {
    const selector = uniqueSelector($, node);
    return selector ? { selector } : {};
  }
  function sceneContext(node: Element): Pick<MotionStructureItem, 'sceneId'> {
    const sceneId = sceneFor(node);
    return sceneId ? { sceneId } : {};
  }
  function add(items: MotionStructureItem[], item: MotionStructureItem, limit: number) {
    if (items.length < limit) items.push(item);
    else warn(`${item.kind} declarations exceed the ${limit}-item inspection limit.`);
  }
  const sceneNodes = new Map<Element, string>();
  root.find('section, [data-composition-id]').each((index, raw) => {
    if (result.scenes.length === MAX_SCENES) { warn(`scene declarations exceed the ${MAX_SCENES}-item inspection limit.`); return false; }
    const node = raw as Element;
    if (!inspectable(node)) return;
    const element = $(node);
    if (element.attr('data-motion-role') === 'caption') return;
    if (element.attr('data-start') === undefined && element.attr('data-duration') === undefined) return;
    const timing = interval(node, `Scene ${index + 1}`);
    if (!timing) return;
    const item: MotionStructureItem = {
      id: `scene-${index + 1}`, kind: 'scene', label: labelFor($, node, `Scene ${index + 1}`),
      ...locator(node), ...timing,
    };
    add(result.scenes, item, MAX_SCENES);
    if (result.scenes.includes(item)) sceneNodes.set(node, item.id);
  });
  function sceneFor(node: Element): string | undefined {
    let current: Element | null = node;
    while (current) {
      const sceneId = sceneNodes.get(current);
      if (sceneId) return sceneId;
      const parent: CheerioNode | null = current.parent;
      current = parent && parent.type === 'tag' ? parent as Element : null;
    }
    return undefined;
  }
  root.find('h1, h2, h3, [data-motion-role="text"], [data-motion-role="title"]').each((index, raw) => {
    if (result.texts.length === MAX_CONTENT_ITEMS) { warn(`text declarations exceed the ${MAX_CONTENT_ITEMS}-item inspection limit.`); return false; }
    const node = raw as Element;
    if (!inspectable(node)) return;
    if ($(node).attr('data-motion-role') === 'caption') return;
    const text = compactText($, node);
    if (!text) return;
    const hasTiming = $(node).attr('data-start') !== undefined || $(node).attr('data-duration') !== undefined;
    const timing = hasTiming ? interval(node, `Text ${index + 1}`) : null;
    add(result.texts, {
      id: `text-${index + 1}`, kind: 'text', label: text.slice(0, 120), text,
      ...locator(node), ...sceneContext(node), ...(timing ?? {}),
    }, MAX_CONTENT_ITEMS);
  });
  // The existing Motion player discovers audio at document scope, including siblings of the root.
  $('audio[src]').each((index, raw) => {
    if (result.audio.length === MAX_CONTENT_ITEMS) { warn(`audio declarations exceed the ${MAX_CONTENT_ITEMS}-item inspection limit.`); return false; }
    const node = raw as Element;
    if (!inspectable(node)) return;
    const src = $(node).attr('src')?.trim();
    const timing = interval(node, `Audio ${index + 1}`, 0);
    if (!src || !timing) return;
    add(result.audio, {
      id: `audio-${index + 1}`, kind: 'audio', label: labelFor($, node, `Audio ${index + 1}`),
      src, ...sceneContext(node), ...timing,
    }, MAX_CONTENT_ITEMS);
  });
  root.find('[data-motion-role="caption"]').each((index, raw) => {
    if (result.captions.length === MAX_CONTENT_ITEMS) { warn(`caption declarations exceed the ${MAX_CONTENT_ITEMS}-item inspection limit.`); return false; }
    const node = raw as Element;
    if (!inspectable(node)) return;
    const timing = interval(node, `Caption ${index + 1}`);
    const text = compactText($, node);
    if (!text || !timing) return;
    add(result.captions, {
      id: `caption-${index + 1}`, kind: 'caption', label: text.slice(0, 120), text,
      ...locator(node), ...sceneContext(node), ...timing,
    }, MAX_CONTENT_ITEMS);
  });
  if (!result.scenes.length) warn('No valid scene declarations; use the complete composition.');
  return result;
}
