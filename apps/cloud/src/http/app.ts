import express, { type Express } from "express";
import { randomUUID } from "node:crypto";
import { BizError } from "@open-design/biz/errors";
import { errors } from "./errors.js";
import { createHttpIdentity } from "./auth-context.js";
import { accountRoutes } from "../routes/account.js";
import { workspaceRoutes } from "../routes/workspaces.js";
import type { AccountFacade } from "../facades/account/index.js";
import type { WorkspaceFacade } from "../facades/workspaces/index.js";
export function createCloudApp(options: {
  webUrl: string;
  secureCookies: boolean;
  profile: "test" | "prod";
  velaWebUrl: string;
  modelId: string | null;
  account: AccountFacade;
  workspaces: WorkspaceFacade;
  checkReadiness(): Promise<void>;
}): {
  app: Express;
  http: ReturnType<typeof createHttpIdentity>;
  finish(): void;
} {
  const app = express(),
    http = createHttpIdentity(options.secureCookies);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    const origin = new URL(options.webUrl).origin;
    if (req.get("origin") === origin) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers":
          "Content-Type, Last-Event-ID, X-Vela-Locale, X-Request-ID, X-OD-Workspace-ID, X-OD-Workspace-Member-ID, X-OD-Workspace-Type, X-OD-Workspace-Role, X-OD-Workspace-Lifecycle-State, X-OD-Workspace-Member-Status, X-OD-Workspace-Can-Share-Projects, X-OD-Workspace-Can-Write-Synced-Files",
        "Access-Control-Expose-Headers":
          "X-Request-ID, X-Error-Code, Content-Disposition",
        "Access-Control-Allow-Methods":
          "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      });
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("origin") !== new URL(options.webUrl).origin ||
        req.get("sec-fetch-site") === "cross-site")
    ) {
      next(new BizError("untrusted_origin"));
      return;
    }
    next();
  });
  app.use(
    express.text({ type: ["application/json", "text/plain"], limit: "1mb" }),
  );
  app.get(["/health", "/api/health"], (_req, res) => res.json({ ok: true }));
  app.get("/ready", async (_req, res) => {
    await options.checkReadiness();
    res.json({ ok: true });
  });
  accountRoutes(app, options.account, http, {
    profile: options.profile,
    webUrl: options.velaWebUrl,
  });
  workspaceRoutes(app, options.workspaces, http, {
    profile: options.profile,
    modelId: options.modelId,
  });
  // Remaining route modules are installed before final error handling by the main composition.
  return {
    app,
    http,
    finish() {
      app.use((_req, _res, next) => next(new BizError("resource_unavailable")));
      app.use(errors);
    },
  };
}
