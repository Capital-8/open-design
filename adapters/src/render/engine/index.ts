import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { BridgeError, type Render } from "@open-design/bridge";
import { renderRequest, exportMime } from "@open-design/contracts/cloud/render";
import { renderExport } from "./renderer.js";
import { RenderFailure } from "./error.js";
export interface RenderEngineOptions {
  executablePath: string;
  ffmpegPath: string;
  domToPptxBundle?: string;
}
export function createLocalRenderAdapter(options: RenderEngineOptions) {
  const config = {
    ...options,
    domToPptxBundle:
      options.domToPptxBundle ??
      fileURLToPath(
        new URL(
          "../../../vendor/dom-to-pptx/dom-to-pptx.bundle.js.gz",
          import.meta.url,
        ),
      ),
  };
  let ready = false;
  const adapter: Render = {
    async getCapabilities() {
      return ready
        ? {
            available: true,
            formats: ["pdf", "pdf-image", "pptx", "image", "mp4"],
            editablePptx: true,
            limits: {
              maxInputBytes: 2 * 1024 * 1024,
              maxOutputBytes: 20 * 1024 * 1024,
            },
          }
        : { available: false, reason: "renderer_not_ready" };
    },
    async render(input) {
      if (!ready) throw new BridgeError("renderer_unavailable");
      const parsed = renderRequest.safeParse(input);
      if (!parsed.success || Buffer.byteLength(input.html) > 2 * 1024 * 1024)
        throw new BridgeError("invalid_render_request");
      try {
        const bytes = await renderExport(parsed.data, config);
        return {
          bytes,
          mimeType: exportMime[parsed.data.format],
          format: parsed.data.format,
        };
      } catch (error) {
        if (error instanceof RenderFailure) throw new BridgeError(error.code);
        throw new BridgeError("export_render_failed");
      }
    },
  };
  return {
    adapter,
    async checkReadiness() {
      await Promise.all([
        access(config.executablePath, constants.X_OK),
        access(config.ffmpegPath, constants.X_OK),
      ]);
      gunzipSync(await readFile(config.domToPptxBundle));
      ready = true;
    },
    async close() {
      ready = false;
    },
  };
}
