import express, { type Express, type ErrorRequestHandler } from "express";
import { render, BridgeError } from "@open-design/bridge";
import { renderRequest } from "@open-design/contracts/cloud/render";
import type { createRenderJob } from "../jobs/render/index.js";
export function createRendererApp(
  job: ReturnType<typeof createRenderJob>,
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/ready", async (_req, res) => {
    const caps = await render.getCapabilities();
    if (!caps.available) {
      res.status(503).json({ code: caps.reason });
      return;
    }
    res.json({
      ok: true,
      exportFormats: caps.formats,
      editablePptx: caps.editablePptx,
    });
  });
  app.use(express.json({ limit: "3mb" }));
  app.post(["/render", "/render-export"], async (req, res) => {
    const parsed = renderRequest.safeParse(
      req.path === "/render"
        ? { html: req.body?.html, format: "pdf" }
        : req.body,
    );
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_render_request" });
      return;
    }
    try {
      const result = await job.execute(parsed.data);
      res.type(result.mimeType).send(Buffer.from(result.bytes));
    } catch (error) {
      const code =
        error instanceof BridgeError ? error.code : "export_render_failed";
      res
        .status(
          code === "renderer_busy"
            ? 429
            : code === "renderer_unavailable"
              ? 503
              : code === "export_render_failed"
                ? 502
                : 422,
        )
        .json({ code });
    }
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ code: "invalid_request" });
  };
  app.use(errors);
  return app;
}
