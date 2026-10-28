import { jsonBody } from "../http/input.js";
import { classification } from "@open-design/biz/files/metadata";
import express, { type Express, type Request, type Response } from "express";
import { extname } from "node:path";
import { legacyFiles } from "@open-design/contracts/cloud/legacy-files";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  uploadedFiles,
} from "@open-design/contracts/cloud/legacy-attachments";
import { BizError } from "@open-design/biz/errors";
import { isAttachmentPath } from "@open-design/biz/files/attachments";
import type { FileFacade } from "../facades/files/index.js";
import type { ProjectAccess } from "../facades/projects/index.js";
import { editRoutes } from "./edit.js";
const unsupported = () =>
  new BizError("unsupported_feature", "当前功能暂时无法使用");
const protocolError = () =>
  new BizError(
    "runtime_protocol_error",
    "Cloud directory response is invalid",
    true,
  );
function safePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\\u0000-\u001f\u007f]/.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function fileRoutes(
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
  const { files, authorize } = deps;
  editRoutes(app, deps);
  app.get("/api/projects/:id/directory", async (req, res) =>
    res.json(
      await files.directory(
        await authorize(req, res, String(req.params.id)),
        typeof req.query.cursor === "string" ? req.query.cursor : "",
      ),
    ),
  );
  app.get("/api/projects/:id/files/index.html", async (req, res) =>
    res.json(
      await files.read(await authorize(req, res, String(req.params.id))),
    ),
  );
  app.put("/api/projects/:id/files/index.html", async (req, res) => {
    const input = jsonBody(req);
    if (typeof input.html !== "string" || typeof input.expected !== "string")
      throw new BizError("invalid_input");
    res.json(
      await files.save(
        await authorize(req, res, String(req.params.id)),
        input.html,
        input.expected,
      ),
    );
  });
  app.get("/api/projects/:id/files/index.html/download", async (req, res) => {
    const content = await files.read(
      await authorize(req, res, String(req.params.id)),
    );
    res
      .set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="index.html"',
        "Content-Security-Policy": "sandbox; default-src 'none'",
      })
      .send(Buffer.from(content.html));
  });
  app.post(
    "/api/projects/:id/upload",
    async (req, res, next) => {
      await authorize(req, res, String(req.params.id));
      if (!req.is("multipart/form-data"))
        throw new BizError(
          "invalid_content_type",
          "请使用 multipart/form-data 上传附件",
        );
      next();
    },
    express.raw({
      type: "multipart/form-data",
      limit: MAX_UPLOAD_BYTES,
      inflate: false,
    }),
    async (req, res) => {
      // Recheck identity after consuming the body; no rejected partial batch is
      // persisted. Native multipart decoding is bounded by the raw body limit.
      const access = await authorize(req, res, String(req.params.id));
      let form: FormData;
      try {
        form = await new Response(new Uint8Array(req.body), {
          headers: { "content-type": req.get("content-type")! },
        }).formData();
      } catch {
        throw new BizError("invalid_upload", "附件上传内容无效");
      }
      if (
        [...form.keys()].some((key) => !["files", "dir"].includes(key)) ||
        form.getAll("dir").length > 1
      )
        throw new BizError("invalid_upload", "附件上传字段无效");
      // This API stores attachment references, not arbitrary Runtime files.
      if (form.has("dir") && form.get("dir") !== "")
        throw new BizError("unsupported_feature", "暂不支持上传到指定工程目录");
      const incoming = form.getAll("files");
      if (
        !incoming.length ||
        incoming.length > MAX_UPLOAD_FILES ||
        incoming.some((file) => typeof file === "string")
      )
        throw new BizError("invalid_upload", "每次请上传 1–12 个附件");
      const batch = await Promise.all(
        (incoming as File[]).map(async (file) => ({
          name: file.name,
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      );
      res.json(
        uploadedFiles.parse({
          files: await files.upload(access, batch),
        }),
      );
    },
  );
  app.get("/api/projects/:id/files", async (req, res) => {
    const id = String(req.params.id),
      access = await authorize(req, res, id);
    const p = access.p;
    // Runtime is paginated while the original client expects one complete list.
    // Never publish a partial/empty success after an upstream error or cursor loop.
    const rows: unknown[] = [],
      paths = new Set<string>(),
      cursors = new Set<string>();
    const mtime = await files.activity(access);
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      if (cursors.has(cursor)) throw protocolError();
      cursors.add(cursor);
      const result = await files.directory(access, cursor);
      if (!Array.isArray(result.files) || typeof result.cursor !== "string")
        throw protocolError();
      for (const file of result.files) {
        if (
          !safePath(file.path) ||
          paths.has(file.path) ||
          !["file", "dir", "directory"].includes(file.kind)
        )
          throw protocolError();
        paths.add(file.path);
        const size = Number(file.size);
        if (!Number.isSafeInteger(size) || size < 0) throw protocolError();
        rows.push({
          name: file.path,
          path: file.path,
          type: file.kind === "file" ? "file" : "dir",
          size,
          mtime,
          ...classification(file.path),
        });
        if (rows.length > 10000) throw protocolError();
      }
      if (!result.cursor) {
        const uploaded = await files.attachments(access);
        if (uploaded.some((file) => paths.has(file.path)))
          throw protocolError();
        return res.json(legacyFiles.parse({ files: [...rows, ...uploaded] }));
      }
      cursor = result.cursor;
    }
    throw protocolError();
  });
  // The client fetches this URL as text for source view and navigates an iframe
  // to it for passive preview. Keep it cookie/project scoped, never filesystem
  // scoped. CSP sandbox also isolates HTML opened directly in a browser tab.
  app.all("/api/projects/:id/raw/*path", async (req, res) => {
    const id = String(req.params.id),
      access = await authorize(req, res, id);
    const path = Array.isArray(req.params.path)
      ? req.params.path.join("/")
      : req.params.path;
    if (!safePath(path))
      throw new BizError("invalid_path", "Invalid project file path");
    if (["GET", "HEAD"].includes(req.method) && isAttachmentPath(path)) {
      const value = await files.attachment(access, path);
      res.set({
        "Content-Type": value.mime,
        "Content-Length": String(value.content.length),
        "Content-Disposition": `${value.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(value.original_name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "Content-Security-Policy":
          "sandbox; default-src 'none'; frame-ancestors 'self'",
        "Referrer-Policy": "no-referrer",
      });
      return res.send(value.content);
    }
    if (!["GET", "HEAD"].includes(req.method)) throw unsupported();
    if (path !== "index.html") {
      if (path.includes("/")) throw unsupported();
      const bytes = await files.raw(access, path);
      const type = classification(path);
      res.set({
        "Content-Type": type.mime,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": ["video", "audio"].includes(type.kind)
          ? "default-src 'none'; media-src 'self'; frame-ancestors 'self'"
          : "sandbox; default-src 'none'; frame-ancestors 'self'",
        "Content-Disposition": `${["video", "audio", "image"].includes(type.kind) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      });
      const range = req.get("Range");
      if (!range) {
        res.set("Content-Length", String(bytes.length));
        return res.send(bytes);
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const suffix = match && !match[1] && match[2] ? Number(match[2]) : null;
      const start =
        suffix !== null
          ? Math.max(0, bytes.length - suffix)
          : Number(match?.[1] ?? NaN);
      const end =
        suffix !== null || !match?.[2]
          ? bytes.length - 1
          : Math.min(Number(match[2]), bytes.length - 1);
      if (
        !match ||
        (!match[1] && !match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= bytes.length ||
        end < start ||
        suffix === 0
      ) {
        res.set("Content-Range", `bytes */${bytes.length}`);
        return res.status(416).end();
      }
      res.set({
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": String(end - start + 1),
      });
      return res.status(206).send(bytes.subarray(start, end + 1));
    }
    const value = await files.read(access);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
    });
    return res.send(value.html);
  });
}
