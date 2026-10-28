export { startRenderer } from "./bootstrap/renderer.js";
export type { RendererOptions } from "./bootstrap/renderer.js";
import { isEntrypoint, runEntrypoint } from "./bootstrap/entry.js";
if (isEntrypoint(import.meta.url))
  await runEntrypoint(async () => {
    const { rendererConfig } = await import("./config/renderer.js");
    const { launchRenderer } = await import(
      "./bootstrap/render-application.js"
    );
    return launchRenderer(rendererConfig());
  });
