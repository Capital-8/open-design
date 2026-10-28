import { createLocalRenderAdapter } from "@open-design/adapters/render/engine";
import { createRenderJob } from "../jobs/render/index.js";
import { createRendererApp } from "../routes/renderer.js";
import { startRenderer } from "./renderer.js";
import { listen } from "./listen.js";
import type { rendererConfig } from "../config/renderer.js";
export async function launchRenderer(
  config: ReturnType<typeof rendererConfig>,
) {
  const engine = createLocalRenderAdapter(config),
    job = createRenderJob();
  return startRenderer({
    async createResources() {
      return {
        bindings: { render: engine.adapter },
        async checkSupport() {},
        checkReadiness: engine.checkReadiness,
        close: engine.close,
      };
    },
    async start() {
      const listener = await listen(
        createRendererApp(job),
        config.host,
        config.port,
      );
      return async () => {
        await listener.close();
        await job.stop();
      };
    },
  });
}
