import { DependencyError } from '../error.js';
import { z } from 'zod';
import { baseUrl, bytes, check, json } from '../internal/http.js';

const formats = ['pdf', 'pdf-image', 'pptx', 'image', 'mp4'] as const;
export type RendererFormat = typeof formats[number];
export const rendererLimits = Object.freeze({ maxInputBytes: 2 * 1024 * 1024, maxOutputBytes: 20 * 1024 * 1024 });
const { maxInputBytes, maxOutputBytes } = rendererLimits;
const mime: Record<RendererFormat, string> = {
  pdf: 'application/pdf', 'pdf-image': 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  image: 'image/png', mp4: 'video/mp4',
};
const requestSchema = z.object({
  html: z.string().min(1).max(maxInputBytes), format: z.enum(formats),
  deck: z.boolean().default(false), editable: z.boolean().default(false),
  index: z.number().int().min(0).max(79).optional(),
  width: z.number().int().min(320).max(4096).optional(),
  height: z.number().int().min(180).max(2304).optional(),
}).strict().refine(v =>
  !(v.format === 'mp4' && (v.deck || v.width !== undefined || v.height !== undefined))
  && !(v.editable && v.format !== 'pptx')
  && !(v.format === 'pptx' && !v.deck)
  && !(v.index !== undefined && (v.format !== 'image' || !v.deck))
  && Buffer.byteLength(v.html, 'utf8') <= maxInputBytes,
);
const readySchema = z.object({ exportFormats: z.array(z.string()), editablePptx: z.boolean() });

export type RendererRequest = z.input<typeof requestSchema>;

/** Renderer wire protocol; no project access, download policy or artifact persistence. */
export function createRendererClient(options: { url: string; fetch?: typeof fetch }) {
  const url = baseUrl(options.url), fetcher = options.fetch ?? fetch;
  return {
    async getReady() {
      try {
        const response = await fetcher(url + '/ready', {
          redirect: 'error', signal: AbortSignal.timeout(2000),
        });
        await check(response);
        const parsed = readySchema.safeParse(await json(response));
        if (!parsed.success) throw new DependencyError('dependency_protocol_error');
        return parsed.data;
      } catch (error) {
        if (error instanceof DependencyError) throw error;
        throw new DependencyError('renderer_unavailable');
      }
    },
    async renderExport(input: RendererRequest) {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) throw new DependencyError('invalid_render_request');
      const request = parsed.data;
      try {
        const response = await fetcher(url + '/render-export', {
          method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(request.format === 'mp4' ? 310000 : 35000),
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        });
        await check(response, true);
        if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== mime[request.format]) {
          await response.body?.cancel().catch(() => undefined);
          throw new DependencyError('renderer_invalid_output', true);
        }
        const output = await bytes(response, maxOutputBytes);
        const prefix = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
        const valid = request.format === 'mp4'
          ? prefix.length > 12 && prefix.subarray(4, 8).toString() === 'ftyp'
          : request.format === 'pptx' ? prefix.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
          : request.format === 'image' ? prefix.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          : prefix.subarray(0, 5).toString() === '%PDF-';
        if (!valid) throw new DependencyError('renderer_invalid_output', true);
        return { bytes: output, mimeType: mime[request.format], format: request.format };
      } catch (error) {
        if (error instanceof DependencyError) throw error;
        // A lost HTTP response does not prove that the rendering process stopped.
        throw new DependencyError('renderer_unavailable', true);
      }
    },
  };
}
