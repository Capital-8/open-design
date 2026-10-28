import { appliedPlugin, readApplied } from "@open-design/biz/catalog/selection";
import { officialCatalog } from "@open-design/biz/catalog/official";
import type { Express, Request, Response } from "express";
import { extname, posix } from "node:path";
import {
  BundledCatalog,
  defaultBundledCatalog,
  type CatalogKind,
} from "@open-design/biz/catalog";
import { BizError } from "@open-design/biz/errors";
import { PreviewTickets } from "../http/preview-ticket.js";
import {
  previewPath,
  rewritePreviewResources,
  iframeShellTarget,
} from "@open-design/biz/catalog/preview";
import { zipFiles } from "@open-design/biz/exports";
import { downloadDisposition } from "../http/download.js";

export function resourceRoutes(
  app: Express,
  authorize: (req: Request, res: Response) => Promise<unknown>,
  supplied?: BundledCatalog,
) {
  const catalog = () => supplied ?? defaultBundledCatalog();
  const tickets = new PreviewTickets();
  const readOnly = () =>
    new BizError(
      "catalog_read_only",
      "当前插件、Skill 和设计体系目录仅支持只读，安装、卸载和修改功能暂时无法使用",
    );
  const param = (value: unknown) => String(value ?? "");
  // Installed means shipped with this POC image, not installed by the current
  // account. POC-022 will introduce user/workspace ownership in cloud storage.
  app.get("/api/official-resources", async (req, res) => {
    await authorize(req, res);
    const catalog = await officialCatalog();
    res.json({
      schemaVersion: 1,
      resources: catalog.meta.resources.map((r) => ({
        type: r.type,
        id: r.id,
        title: r.title,
        issues: r.issues,
      })),
    });
  });
  for (const route of ["apply", "apply-local"]) {
    app.post(`/api/plugins/:id/${route}`, async (req, res) => {
      await authorize(req, res);
      let body;
      try {
        body = JSON.parse(req.body || "{}");
      } catch {
        throw new BizError("invalid_input", "无效请求");
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (k) =>
            !["source", "inputs", "projectId", "grantCaps", "locale"].includes(
              k,
            ),
        ) ||
        body.grantCaps?.length
      )
        throw new BizError(
          "unsupported_plugin_capability",
          "仅支持官方插件静态资源",
        );
      res.json(
        await appliedPlugin(
          String(req.params.id),
          body.inputs ?? {},
          body.source,
          body.locale,
        ),
      );
    });
  }
  app.get("/api/applied-plugins/:id", async (req, res) => {
    await authorize(req, res);
    res.json(await readApplied(String(req.params.id)));
  });
  app.get("/api/design-templates", async (req, res) => {
    await authorize(req, res);
    res.json({ templates: await catalog().skills(true) });
  });
  app.get("/api/plugins", async (req, res) => {
    await authorize(req, res);
    res.json({ plugins: await catalog().plugins(), readOnly: true });
  });
  app.get("/api/marketplaces", async (req, res) => {
    await authorize(req, res);
    res.json({ marketplaces: [await catalog().marketplace()], readOnly: true });
  });
  app.get("/api/marketplaces/:id", async (req, res) => {
    await authorize(req, res);
    res.json(await catalog().marketplace(param(req.params.id)));
  });
  app.get("/api/marketplaces/:id/plugins", async (req, res) => {
    await authorize(req, res);
    res.json({
      plugins: (await catalog().marketplace(param(req.params.id))).manifest
        .plugins,
    });
  });
  app.get("/api/plugins/:id", async (req, res) => {
    await authorize(req, res);
    res.json(await catalog().plugin(param(req.params.id)));
  });
  app.get("/api/skills", async (req, res) => {
    await authorize(req, res);
    res.json({ skills: await catalog().skills(), readOnly: true });
  });
  app.get("/api/skills/:id", async (req, res) => {
    await authorize(req, res);
    res.json(await catalog().skill(param(req.params.id)));
  });
  app.get("/api/skills/:id/files", async (req, res) => {
    await authorize(req, res);
    res.json({ files: await catalog().files("skill", param(req.params.id)) });
  });
  app.get("/api/design-systems", async (req, res) => {
    await authorize(req, res);
    res.json({
      designSystems: await catalog().designSystems(),
      readOnly: true,
    });
  });
  app.get("/api/design-systems/:id", async (req, res) => {
    await authorize(req, res);
    const detail = await catalog().designSystemDetail(param(req.params.id));
    res.json({ ...detail, designSystem: detail });
  });
  const designFiles = async (id: string) =>
    (await catalog().files("design-system", id)).map((file) => ({
      path: file.path,
      size: file.size,
      name: posix.basename(file.path),
      kind: /\.html?$/i.test(file.path)
        ? "page"
        : /\.css$/i.test(file.path)
          ? "stylesheet"
          : /\.(?:md|txt)$/i.test(file.path)
            ? "document"
            : /\.json$/i.test(file.path)
              ? "data"
              : /\.(?:svg|png|jpe?g|webp|gif)$/i.test(file.path)
                ? "image"
                : "asset",
    }));
  const queryPath = (req: Request) => {
    if (typeof req.query.path !== "string")
      throw new BizError("invalid_asset_path", "Resource path is required");
    return req.query.path;
  };
  app.get("/api/design-systems/:id/files", async (req, res) => {
    await authorize(req, res);
    res.json({ files: await designFiles(param(req.params.id)) });
  });
  app.get("/api/design-systems/:id/archive", async (req, res) => {
    await authorize(req, res);
    const id = param(req.params.id),
      system = await catalog().designSystem(id);
    const inventory = await catalog().files("design-system", id);
    if (inventory.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024)
      throw new BizError("export_too_large", "设计体系资源包超过 100 MiB");
    const files = [];
    for (const file of inventory)
      files.push({
        path: `${id}/${file.path}`,
        bytes: await catalog().asset("design-system", id, file.path),
      });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": downloadDisposition(system.title, "zip"),
    });
    res.send(await zipFiles(files));
  });
  app.get("/api/design-systems/:id/file", async (req, res) => {
    await authorize(req, res);
    const id = param(req.params.id),
      path = queryPath(req);
    const bytes = await catalog().asset("design-system", id, path);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (content.includes("\0")) throw new Error("Binary resource");
    } catch {
      throw new BizError("binary_resource", "请使用静态资源接口读取二进制文件");
    }
    const file = (await designFiles(id)).find(
      (file) => file.path === path.replace(/^\.\//, ""),
    )!;
    res.json({ file: { ...file, content } });
  });
  app.get("/api/design-systems/:id/static", async (req, res) => {
    await serve(req, res, "design-system", queryPath(req));
  });
  for (const route of ["preview", "showcase"]) {
    app.get(`/api/design-systems/:id/${route}`, async (req, res) => {
      await authorize(req, res);
      const files = await catalog().files(
        "design-system",
        param(req.params.id),
      );
      // Use actual shipped pages; two bundles have no system/kit.html.
      const candidates =
        route === "preview"
          ? ["preview/colors.html", "components.html", "system/kit.html"]
          : ["system/kit.html", "components.html", "preview/colors.html"];
      const path = candidates.find((path) =>
        files.some((file) => file.path === path),
      );
      if (!path)
        throw new BizError(
          "preview_unavailable",
          "此设计体系没有可用的内置预览",
        );
      await serve(req, res, "design-system", path);
    });
  }
  async function serve(
    req: Request,
    res: Response,
    kind: CatalogKind,
    path: string,
  ) {
    const id = param(req.params.id);
    const suppliedTicket = req.query.od_preview_ticket;
    // Namespace design-system grants so equal IDs across catalogs cannot share
    // preview access. No ticket grants access to catalog/detail/business APIs.
    const ticketId = kind === "design-system" ? `design-system:${id}` : id;
    const renderable = kind !== "skill";
    const ticketValid = renderable && tickets.allows(ticketId, suppliedTicket);
    if (!ticketValid) await authorize(req, res);
    const ticket = renderable
      ? ticketValid
        ? String(suppliedTicket)
        : tickets.issue(ticketId)
      : undefined;
    let bytes = await catalog().asset(kind, id, path);
    if (renderable && /\.html?$/i.test(path)) {
      // Some bundled previews are just wrappers around another HTML file.
      // Inline that indexed document instead of granting nested-frame access.
      const target = iframeShellTarget(bytes.toString(), path);
      if (
        target &&
        (await catalog().files(kind, id)).some((f) => f.path === target)
      ) {
        path = target;
        bytes = await catalog().asset(kind, id, target);
      }
    }
    if (renderable && /\.(?:html?|css)$/i.test(path))
      bytes = Buffer.from(
        rewritePreviewResources(
          bytes.toString(),
          id,
          path,
          /\.html?$/i.test(path),
          ticket,
          kind === "design-system" ? "design-system" : "plugin",
        ),
      );
    // Renderable plugin content is isolated even when visited as a top-level
    // document. Do not grant same-origin access to session/API credentials.
    res.set({
      "Content-Security-Policy":
        "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      // Fonts/module scripts in an opaque-origin frame require CORS. The
      // scoped ticket authorizes bundled bytes only; credentials are not shared.
      ...(ticket ? { "Access-Control-Allow-Origin": "*" } : {}),
    });
    const extension = extname(path).toLowerCase();
    if ([".md", ".txt", ".py", ".sh"].includes(extension))
      res.type("text/plain");
    else if (
      [
        ".html",
        ".htm",
        ".css",
        ".js",
        ".json",
        ".svg",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".woff",
        ".woff2",
      ].includes(extension)
    )
      res.type(extension);
    else res.type("application/octet-stream");
    res.send(bytes);
  }
  for (const [route, kind] of [
    ["/api/plugins/:id/asset/*path", "plugin"],
    ["/api/skills/:id/assets/*path", "skill"],
    ["/api/design-systems/:id/asset/*path", "design-system"],
  ] as const) {
    app.get(route, async (req, res) => {
      const parts = req.params.path;
      await serve(
        req,
        res,
        kind,
        Array.isArray(parts) ? parts.join("/") : param(parts),
      );
    });
  }
  app.get("/api/plugins/:id/preview", async (req, res) => {
    await authorize(req, res);
    const plugin = await catalog().plugin(param(req.params.id));
    await serve(req, res, "plugin", await previewPath(catalog(), plugin));
  });
  app.get("/api/plugins/:id/example/:name", async (req, res) => {
    await authorize(req, res);
    const plugin = await catalog().plugin(param(req.params.id));
    await serve(
      req,
      res,
      "plugin",
      await previewPath(catalog(), plugin, param(req.params.name)),
    );
  });
  // Keep unsupported writes explicit, including future routes. No network
  // download, registry update, fs deletion or execution is reachable here.
  app.all(
    /^\/api\/(plugins|skills|design-systems|marketplaces|plugin-marketplaces|applied-plugins)(?:\/.*)?$/,
    async (req, res, next) => {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      await authorize(req, res);
      throw readOnly();
    },
  );
}
