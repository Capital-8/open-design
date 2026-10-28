import type { Express } from "express";
import { z } from "zod";
import { requireSelectable } from "@open-design/biz/workspaces";
import { BizError } from "@open-design/biz/errors";
import type { WorkspaceFacade } from "../facades/workspaces/index.js";
import type { HttpIdentity } from "../http/auth-context.js";
import { jsonBody } from "../http/input.js";
export function workspaceRoutes(
  app: Express,
  facade: WorkspaceFacade,
  http: HttpIdentity,
  options: { profile: string; modelId: string | null },
) {
  app.get("/api/billing/summary", async (req, res) =>
    res.json({
      source: "vela",
      summary: await facade.summary(await http.context(req, res)),
      settlement: {
        status: "unavailable",
        reason: "runtime_usage_not_integrated",
      },
    }),
  );
  app.get("/api/workspace/directory", async (req, res) => {
    const { items } = await facade.directory(await http.context(req, res));
    const claimed = items.find(
      (item) =>
        item.workspaceId === req.get("x-od-workspace-id") &&
        item.workspaceMemberId === req.get("x-od-workspace-member-id"),
    );
    res.json({
      items,
      activeWorkspaceId:
        claimed?.workspaceId ??
        items.find((item) => item.workspaceType === "personal")?.workspaceId ??
        items[0]?.workspaceId ??
        null,
    });
  });
  app.get("/api/workspace/context", async (req, res) =>
    res.json({
      context: (
        await facade.selected(
          await http.context(req, res),
          req.get("x-od-workspace-id"),
          req.get("x-od-workspace-member-id"),
        )
      ).context,
    }),
  );
  app.put("/api/workspace/active", async (req, res) => {
    const body = jsonBody(req),
      { context } = await facade.selected(
        await http.context(req, res),
        body.workspaceId,
        body.workspaceMemberId,
      );
    requireSelectable(context);
    res.json({ activeWorkspaceId: context.workspaceId, context });
  });
  app.get("/api/workspace/members", async (req, res) =>
    res.json(
      await facade.members(
        await http.context(req, res),
        req.get("x-od-workspace-id"),
        req.get("x-od-workspace-member-id"),
      ),
    ),
  );
  app.post("/api/workspace/invite", async (req, res) => {
    const input = z
      .object({
        invites: z
          .array(
            z
              .object({
                email: z.string().trim().email().max(254),
                role: z.enum(["admin", "member"]),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict()
      .safeParse(jsonBody(req));
    if (!input.success) throw new BizError("invalid_input");
    res.json(
      await facade.invite(
        await http.context(req, res),
        req.get("x-od-workspace-id"),
        req.get("x-od-workspace-member-id"),
        input.data.invites,
      ),
    );
  });
  app.get("/api/workspace/billing", async (req, res) => {
    const ctx = await http.context(req, res);
    if (req.query.scope === "account" && !req.query.workspaceId) {
      res.json({
        source: "vela",
        summary: await facade.summary(ctx),
        workspaceBalance: null,
      });
      return;
    }
    if (
      req.query.scope !== "workspace" ||
      typeof req.query.workspaceId !== "string" ||
      (req.get("x-od-workspace-id") &&
        req.get("x-od-workspace-id") !== req.query.workspaceId)
    )
      throw new BizError("workspace_selection_required");
    if (
      req.query.modelId &&
      req.query.modelId !== "cloud-runtime-default" &&
      req.query.modelId !== options.modelId
    )
      throw new BizError("unsupported_feature");
    res.json(
      await facade.billing(
        ctx,
        req.query.workspaceId,
        req.get("x-od-workspace-member-id"),
      ),
    );
  });
  app.get("/api/integrations/vela/wallet", async (req, res) => {
    const ctx = await http.context(req, res),
      { identity, items } = await facade.directory(ctx);
    const item =
      items.find((i) => i.workspaceId === req.get("x-od-workspace-id")) ??
      items.find((i) => i.workspaceType === "personal");
    if (!item) throw new BizError("workspace_unavailable");
    const real = await facade.billing(
      ctx,
      item.workspaceId,
      item.workspaceMemberId,
    );
    res.json({
      status: "available",
      source: "vela",
      profile: options.profile,
      user: {
        id: identity.user.id,
        email: identity.user.email,
        name: identity.user.name,
      },
      balanceUsd: real.workspaceBalance.balanceUsd,
      updatedAt: real.workspaceBalance.updatedAt,
      preflight: real.preflight,
      settlement: real.settlement,
    });
  });
}
