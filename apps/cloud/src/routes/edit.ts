import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { BizError as AppError } from "@open-design/biz/errors";
import type { FileFacade } from "../facades/files/index.js";
import type { ProjectAccess } from "../facades/projects/index.js";

type Content = { html: string; version: string; modified?: string };
const input = z
  .object({
    name: z.literal("index.html"),
    content: z.string(),
    parentVersionId: z.string().max(256).optional(),
    versionSource: z.enum(["ai", "manual", "restore", "sync"]).optional(),
    versionLabel: z.string().max(512).optional(),
    versionPrompt: z.string().max(65536).nullable().optional(),
  })
  .strict();

function file(content: Content) {
  return {
    name: "index.html",
    path: "index.html",
    type: "file",
    size: Buffer.byteLength(content.html),
    mtime: content.modified ? Date.parse(content.modified) : 0,
    kind: "html",
    mime: "text/html",
  };
}

function version(content: Content) {
  const revision = Number(content.version.split("@").at(-1));
  return {
    id: content.version,
    fileName: "index.html",
    version: Number.isSafeInteger(revision) ? revision : 1,
    label: "Current filesys revision",
    createdAt: content.modified ? Date.parse(content.modified) : 0,
    source: "sync",
    contentDigest: createHash("sha256").update(content.html).digest("hex"),
    prompt: null,
    size: Buffer.byteLength(content.html),
    mime: "text/html",
    kind: "html",
    current: true,
  };
}

export function editRoutes(
  app: Express,
  deps: {
    files: FileFacade;
    authorize: (
      req: Request,
      res: Response,
      id: string,
    ) => Promise<ProjectAccess>;
  },
) {
  const read = async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const access = await deps.authorize(req, res, id);
    if (req.params.name !== "index.html")
      throw new AppError("unsupported_feature", "Only index.html is editable");
    return deps.files.read(access);
  };
  app.get("/api/projects/:id/files/:name/versions", async (req, res) => {
    const content = await read(req, res);
    res.json({
      file: file(content),
      versions: [version(content)],
      currentOnly: true,
    });
  });
  app.get(
    "/api/projects/:id/files/:name/versions/:version",
    async (req, res) => {
      const content = await read(req, res);
      if (req.params.version !== content.version)
        throw new AppError(
          "runtime_history_unavailable",
          "Historical file versions are not exposed by Runtime",
        );
      res.json({ version: version(content), content: content.html });
    },
  );
  app.post("/api/projects/:id/files", async (req, res) => {
    const id = String(req.params.id);
    const access = await deps.authorize(req, res, id);
    let body: unknown;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      throw new AppError("invalid_request", "Invalid file request");
    }
    const parsed = input.safeParse(body);
    if (!parsed.success)
      throw new AppError(
        "unsupported_feature",
        "Only index.html text edits are supported",
      );
    const value = parsed.data;
    const previous = await deps.files.read(access);
    if (
      value.parentVersionId !== previous.version &&
      value.content !== previous.html
    )
      throw new AppError(
        "conflict",
        "Reload the current file revision before saving",
      );
    const content =
      value.content === previous.html
        ? previous
        : await deps.files.save(access, value.content, previous.version);
    res.json({
      file: file(content),
      version: version(content),
      currentOnly: true,
      unsupportedFields: [
        "versionSource",
        "versionLabel",
        "versionPrompt",
      ].filter((key) => key in value),
    });
  });
}
