import type { Express } from "express";
import { render } from "@open-design/bridge";
import { zipFiles } from "@open-design/biz/exports";
import { BizError } from "@open-design/biz/errors";
import { createPublicMetadata } from "../facades/public-metadata/index.js";
import type { AccountFacade } from "../facades/account/index.js";
import type { RunFacade } from "../facades/runs/index.js";
import type { HttpIdentity } from "../http/auth-context.js";
import { scopeRequest } from "../http/scope.js";
import { downloadDisposition } from "../http/download.js";
import { writeEvent } from "../http/sse.js";
export function compatibilityRoutes(
  app: Express,
  deps: { account: AccountFacade; runs: RunFacade; http: HttpIdentity },
) {
  const metadata = createPublicMetadata();
  app.get("/api/github/open-design", async (_req, res) =>
    res.json(await metadata.github()),
  );
  app.get("/version", (_req, res) => res.json({ version: "cloud-poc" }));
  app.get("/api/version", async (_req, res) => {
    const caps = await render.getCapabilities();
    res.json({
      version: {
        version: "cloud-poc",
        channel: "cloud-poc",
        packaged: false,
        platform: process.platform,
        arch: process.arch,
        capabilities: {
          slideRenderer:
            caps.available &&
            caps.editablePptx &&
            ["pptx", "image", "pdf-image"].every((f) =>
              caps.formats.includes(f as "pptx" | "image" | "pdf-image"),
            ),
        },
      },
    });
  });
  const models = [
    {
      id: "cloud-runtime-default",
      label: "Cloud Runtime Default",
      default: true,
      enabled: true,
    },
  ];
  app.get("/api/amr/models", (_req, res) =>
    res.json({
      source: "preset",
      models,
      refreshing: false,
      remoteError: "云端 POC 使用 Runtime 配置的默认模型",
    }),
  );
  app.get("/api/agents", async (req, res) => {
    const agent = {
      id: "amr",
      name: "OpenDesign Cloud",
      bin: "Cloud Runtime",
      available: true,
      authStatus: "unknown",
      models,
      supportsCustomModel: false,
    };
    if (req.query.stream !== "1") {
      res.json({ agents: [agent] });
      return;
    }
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    res.type("text/event-stream");
    await writeEvent(res, abort.signal, "agent", agent);
    await writeEvent(res, abort.signal, "done", {});
    res.end();
  });
  app.get("/api/diagnostics/export", async (req, res) => {
    const ctx = await deps.http.context(req, res);
    await deps.account.current(ctx);
    const values = await deps.runs.list(ctx, scopeRequest(req));
    const bytes = await zipFiles([
      {
        path: "diagnostics.json",
        bytes: Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            scope: "current-user-cloud-runs",
            recentRuns: values
              .slice(0, 50)
              .map(({ run }) => ({
                id: run.id,
                status: run.status,
                error_code: run.error_code,
                created_at: run.created_at,
              })),
            rendererConfigured: true,
            limitations: ["不包含客户端日志、其他用户记录、任务正文或凭据"],
          }),
        ),
      },
    ]);
    res
      .type("application/zip")
      .set(
        "Content-Disposition",
        downloadDisposition("open-design-diagnostics", "zip"),
      )
      .send(bytes);
  });
  for (const [method, path, code] of [
    ["get", "/api/memory/extractions", "cloud_memory_unavailable"],
    ["delete", "/api/memory/extractions", "cloud_memory_unavailable"],
    ["delete", "/api/memory/extractions/:id", "cloud_memory_unavailable"],
    ["get", "/api/library/assets/:id/raw", "cloud_library_unavailable"],
    ["get", "/api/library/assets/:id/figma", "cloud_library_unavailable"],
  ] as const)
    app[method](path, async (req, res) => {
      await deps.account.current(await deps.http.context(req, res));
      throw new BizError(code);
    });
}
