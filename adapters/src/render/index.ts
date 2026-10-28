import type { Render, RenderFormat } from '@open-design/bridge';
import { createRendererClient, rendererLimits } from '@open-design/dependencies/renderer';
import { callDependency, protocolFetch } from '../internal/errors.js';

const formats = ['pdf', 'pdf-image', 'pptx', 'image', 'mp4'] as const satisfies readonly RenderFormat[];

/** Normalizes the renderer protocol into the existing bridge contract. */
export function createHttpRenderAdapter(options: { url: string; fetch?: typeof fetch }): Render {
  const client = createRendererClient({ url: options.url, fetch: protocolFetch(options.fetch ?? fetch) });
  return {
    async getCapabilities() {
      try {
        const data = await client.getReady();
        return { available: true, formats: formats.filter(f => data.exportFormats.includes(f)),
          editablePptx: data.editablePptx, limits: { ...rendererLimits } };
      } catch { return { available: false, reason: 'renderer_unavailable' }; }
    },
    render(input) { return callDependency(() => client.renderExport(input)); },
  };
}
