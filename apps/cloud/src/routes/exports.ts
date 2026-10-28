import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireCurrent } from "@open-design/biz/exports";
import { BizError } from "@open-design/biz/errors";
import type { ExportFacade } from "../facades/exports/index.js";
import type { ProjectAccess } from "../facades/projects/index.js";
import { jsonBody, parameter } from "../http/input.js";
import { downloadDisposition } from "../http/download.js";
export function exportRoutes(
  app: Express,
  facade: ExportFacade,
  authorize: (
    req: Request,
    res: Response,
    id: string,
  ) => Promise<ProjectAccess>,
) {
  for (const format of [
    "html",
    "pdf",
    "pdf-image",
    "pptx",
    "image",
    "mp4",
  ] as const)
    app.post("/api/projects/:id/export/" + format, async (req, res) => {
      const a = await authorize(req, res, parameter(req.params.id)),
        output = await facade.export(a, format, jsonBody(req));
      res
        .set({
          "Content-Type": output.mimeType,
          "Content-Disposition": downloadDisposition(
            output.title,
            output.extension,
          ),
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Referrer-Policy": "no-referrer",
        })
        .send(Buffer.from(output.bytes));
    });
  app.get("/api/projects/:id/archive", async (req, res) => {
    const a = await authorize(req, res, parameter(req.params.id));
    if (req.query.root !== undefined && typeof req.query.root !== "string")
      throw new BizError("invalid_export");
    res
      .type("application/zip")
      .set("Content-Disposition", downloadDisposition(a.p.name, "zip"))
      .send(
        await facade.archive(a, {
          root: req.query.root,
          version: req.query.versionId,
        }),
      );
  });
  app.post("/api/projects/:id/archive/batch", async (req, res) => {
    const a = await authorize(req, res, parameter(req.params.id)),
      parsed = z
        .object({ files: z.array(z.string()).min(1).max(10000) })
        .strict()
        .safeParse(jsonBody(req));
    if (!parsed.success) throw new BizError("invalid_export");
    res
      .type("application/zip")
      .set("Content-Disposition", downloadDisposition(a.p.name, "zip"))
      .send(
        await facade.archive(a, {
          ...parsed.data,
          version: req.query.versionId,
        }),
      );
  });
  app.get("/api/projects/:id/export/manifest", async (req, res) => {
    const a = await authorize(req, res, parameter(req.params.id));
    res.json(await facade.manifest(a, req.query.versionId));
  });
  app.get("/api/projects/:id/export/*path", async (req, res) => {
    const a = await authorize(req, res, parameter(req.params.id));
    requireCurrent(req.query.versionId);
    const path = Array.isArray(req.params.path)
        ? req.params.path.join("/")
        : parameter(req.params.path),
      bytes = await facade.read(a, path);
    res.set({
      "Content-Type": /\.html?$/i.test(path)
        ? "text/html; charset=utf-8"
        : "application/octet-stream",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      ETag: '"' + createHash("sha256").update(bytes).digest("hex") + '"',
    });
    if (req.query.inline !== "1")
      res.set(
        "Content-Disposition",
        downloadDisposition(path, /\.html?$/i.test(path) ? "html" : "bin"),
      );
    res.send(bytes);
  });
}
