import type { Render } from '@open-design/bridge';
import { startProcess, type Cleanup, type CloudProcess, type CloudResources } from './process.js';

export interface RendererOptions {
  /** Construct the local render engine only. No main-process environment/config is imported. */
  createResources(): Promise<CloudResources & { readonly bindings: { render: Render } }>;
  start(): Promise<Cleanup>;
}

export function startRenderer(options: RendererOptions): Promise<CloudProcess> {
  return startProcess({
    modules: [{ name: 'renderer', required: ['render'], start: options.start.bind(options) }],
    async createResources() {
      const resources = await options.createResources();
      // This entrypoint intentionally cannot install unrelated main-process resources.
      try {
        if (Reflect.ownKeys(resources.bindings).some(key => key !== 'render')) {
          throw new Error('Renderer must provide only the local render capability');
        }
      } catch (failure) {
        try { await resources.close(); } catch (error) {
          throw new AggregateError([failure, error], 'Renderer configuration and cleanup failed');
        }
        throw failure;
      }
      return resources;
    },
  });
}
