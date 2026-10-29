import { motionEditorDocumentSchema, type MotionEditorDocument } from '@open-design/contracts';

export function shiftMotionObjects(document: MotionEditorDocument, ids: string[], delta: number): MotionEditorDocument {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !document.objects.some(object => object.id === id)) || !Number.isFinite(delta)) throw new Error('Unknown selection');
  const objects = document.objects.map(object => ids.includes(object.id) ? {
    ...object, animation: { ...object.animation, start: Math.round((object.animation.start + delta) * 1000) / 1000 },
  } : object);
  return motionEditorDocumentSchema.parse({ ...document, objects });
}

/** Selection order is explicit, not inferred from DOM or z-order. All changes form one transaction. */
export function staggerMotionObjects(document: MotionEditorDocument, ids: string[], interval: number): MotionEditorDocument {
  if (ids.length < 2 || new Set(ids).size !== ids.length || !Number.isFinite(interval) || interval < 0) throw new Error('Invalid stagger');
  const first = document.objects.find(object => object.id === ids[0]);
  if (!first || ids.some(id => !document.objects.some(object => object.id === id))) throw new Error('Unknown selection');
  return motionEditorDocumentSchema.parse({ ...document, objects: document.objects.map(object => {
    const index = ids.indexOf(object.id);
    return index < 0 ? object : { ...object, animation: { ...object.animation, start: Math.round((first.animation.start + index * interval) * 1000) / 1000 } };
  }) });
}
