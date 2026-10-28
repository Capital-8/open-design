import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { projectView, conversationView } from "@open-design/biz/views";
import { allowOnly } from "@open-design/biz/projects/input";
import { ready } from "@open-design/biz/access";
import { BizError } from "@open-design/biz/errors";
import type { ProjectFacade } from "../facades/projects/index.js";
import type { HttpIdentity } from "../http/auth-context.js";
import { jsonBody, parameter } from "../http/input.js";
import { scopeRequest } from "../http/scope.js";
export function projectRoutes(
  app: Express,
  facade: ProjectFacade,
  http: HttpIdentity,
) {
  app.get("/api/projects", async (req, res) =>
    res.json({
      projects: (
        await facade.list(await http.context(req, res), scopeRequest(req))
      ).projects.map(projectView),
    }),
  );
  app.post("/api/projects", async (req, res) => {
    const value = await facade.create(
      await http.context(req, res),
      jsonBody(req),
      scopeRequest(req),
    );
    res
      .status(201)
      .json({
        project: projectView(value.project),
        conversationId: value.conversation.id,
      });
  });
  app.get("/api/projects/:id", async (req, res) => {
    const a = await facade.project(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json({ project: projectView(a.p) });
  });
  app.patch("/api/projects/:id", async (req, res) => {
    const value = jsonBody(req);
    allowOnly(value, ["skillId", "designSystemId"]);
    res.json({
      project: projectView(
        await facade.update(
          await http.context(req, res),
          parameter(req.params.id),
          value,
          scopeRequest(req),
        ),
      ),
    });
  });
  app.get("/api/projects/:id/workspace-scope", async (req, res) => {
    const a = await facade.project(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json({
      scope: {
        kind: a.item.workspaceType,
        projectId: a.p.id,
        workspaceId: a.item.workspaceId,
        visibility: "personal",
        context: a.context,
      },
    });
  });
  app.get("/api/projects/:id/collab/status", async (req, res) => {
    const a = await facade.project(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json({
      shared: false,
      syncState: "local_only",
      ownerMemberId: a.item.workspaceMemberId,
      ownerDisplayName: a.user.name,
      ownerRole: a.item.role,
      publishedVersion: null,
      materializedVersion: null,
      awaitingFirstMaterialization: false,
    });
  });
  app.get("/api/projects/:id/conversations", async (req, res) => {
    const a = await facade.project(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json({
      conversations: (await facade.conversations(a)).map(conversationView),
    });
  });
  app.post("/api/projects/:id/conversations", async (req, res) => {
    const a = await facade.project(
        await http.context(req, res),
        parameter(req.params.id),
        scopeRequest(req),
      ),
      v = jsonBody(req);
    allowOnly(v, ["id", "title", "sessionMode"]);
    if (
      (v.sessionMode && !["design", "chat"].includes(String(v.sessionMode))) ||
      (v.title !== undefined &&
        (typeof v.title !== "string" || v.title.length > 256)) ||
      (v.id !== undefined && typeof v.id !== "string")
    )
      throw new BizError("invalid_input");
    const c = await facade.createConversation(a, {
      id: typeof v.id === "string" ? v.id : randomUUID(),
      title: typeof v.title === "string" ? v.title : null,
    });
    ready(c);
    res.status(201).json({ conversation: conversationView(c) });
  });
  app.get("/api/workspaces/:workspaceId/projects", async (req, res) => {
    const a = await facade.list(
      await http.context(req, res),
      scopeRequest(req),
    );
    if (a.item.workspaceId !== parameter(req.params.workspaceId))
      throw new BizError("resource_unavailable");
    if (
      !["all", "recent", "drafts", "team"].includes(
        String(req.query.view ?? "recent"),
      )
    )
      throw new BizError("invalid_input");
    if (req.query.view === "team") throw new BizError("unsupported_feature");
    res.json({
      projects: a.projects.map((p) => ({
        id: p.id,
        name: p.name,
        workspaceId: a.item.workspaceId,
        visibility: "personal",
        resourceState: "active",
        createdByWorkspaceMemberId: a.item.workspaceMemberId,
        resourceHubResourceId: null,
        syncState: "local_only",
        currentUserAccess: {
          canOpen: true,
          canRename: false,
          canDelete: false,
          canDuplicate: false,
          canMoveToTeam: false,
          canMoveToPersonal: false,
          canExport: false,
          canSendTo: false,
          canRestoreVersion: false,
        },
        createdAt: Date.parse(p.created_at),
        updatedAt: Date.parse(p.created_at),
        metadata: p.metadata_json,
        project: projectView(p),
      })),
    });
  });
}
