import { z } from 'zod';

const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[\da-f]{6}$/iu);
export const motionEditorObjectSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u),
  name: z.string().min(1).max(120),
  type: z.enum(['text', 'shape', 'image']),
  text: z.string().max(4000).optional(),
  // Local project assets only; URL resolution must not escape the composition folder.
  src: z.string().max(500).regex(/^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9_./ -]*\.(?:png|jpe?g|webp|gif)$/iu)
    .refine(value => !value.split('/').includes('..')).optional(),
  x: finite(-8192, 8192), y: finite(-8192, 8192),
  width: finite(1, 8192), height: finite(1, 8192),
  fontSize: finite(1, 512), color, fill: color,
  rotation: finite(-360, 360), opacity: finite(0, 1),
  animation: z.object({
    preset: z.enum(['fade', 'rise', 'slide', 'scale']),
    start: finite(0, 600), duration: finite(0.02, 600),
    easing: z.enum(['linear', 'gentle', 'snappy']),
  }).strict(),
}).strict().superRefine((object, ctx) => {
  if (object.type === 'text' && object.text === undefined) ctx.addIssue({ code: 'custom', message: 'Text content is required', path: ['text'] });
  if (object.type === 'image' && !object.src) ctx.addIssue({ code: 'custom', message: 'Image asset is required', path: ['src'] });
});
export const motionEditorDocumentSchema = z.object({
  schemaVersion: z.literal(1), width: finite(64, 8192).int(), height: finite(64, 8192).int(),
  duration: finite(0.1, 600), fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  background: color, objects: z.array(motionEditorObjectSchema).min(1).max(64),
}).strict().superRefine((document, ctx) => {
  const ids = new Set<string>();
  document.objects.forEach((object, index) => {
    if (ids.has(object.id)) ctx.addIssue({ code: 'custom', message: 'Object IDs must be unique', path: ['objects', index, 'id'] });
    ids.add(object.id);
    if (object.animation.start + object.animation.duration > document.duration + 1e-9) {
      ctx.addIssue({ code: 'custom', message: 'Animation must remain inside the scene', path: ['objects', index, 'animation'] });
    }
  });
});
export type MotionEditorObject = z.infer<typeof motionEditorObjectSchema>;
export type MotionEditorDocument = z.infer<typeof motionEditorDocumentSchema>;
export interface MotionEditorReadRequest { filePath: string }
export interface MotionEditorSaveRequest extends MotionEditorReadRequest {
  baseRevision: string;
  document: MotionEditorDocument;
  label?: string;
}
export type MotionEditorResponse = { supported: false; reason: string } | {
  supported: true; document: MotionEditorDocument; source: string; revision: string; versionWarning?: string;
};

export type MotionEditorPreviewRequest = Omit<MotionEditorSaveRequest, 'label'>;
export interface MotionEditorPreviewResponse { source: string }
