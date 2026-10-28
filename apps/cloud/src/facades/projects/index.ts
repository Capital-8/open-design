import { db, type AuthContext, type RuntimeScope } from "@open-design/bridge";
import { DependencyError } from "@open-design/dependencies";
import { BridgeError } from "@open-design/bridge";
import {
  prepareProject,
  finishProject,
  listProjects,
  updateProject,
  projectFor,
  type ExternalCreation,
} from "@open-design/biz/projects";
import {
  prepareConversation,
  finishConversation,
  conversationFor,
} from "@open-design/biz/conversations";
import { ready, workspaceFor } from "@open-design/biz/access";
import {
  activeWorkspace,
  selectWorkspace,
  requireWorkspaceWrite,
  requireConversationProject,
} from "@open-design/biz/workspaces";
import { projectInput } from "@open-design/biz/projects/input";
import {
  ensureRuntimeResources,
  selectionsFor,
} from "@open-design/biz/catalog/selection";
import type { ResourceSelection } from "@open-design/biz/catalog/official";
import { BizError } from "@open-design/biz/errors";
import type { WorkspaceFacade } from "../workspaces/index.js";
export interface ExternalProjects {
  createProject(scope: RuntimeScope, name: string): Promise<{ id: string }>;
  createSession(
    scope: RuntimeScope,
    projectId: string,
  ): Promise<{ id: string; project: string }>;
  officialResources(
    scope: RuntimeScope,
  ): Promise<{
    version: 1;
    maxSelections: number;
    resources: ResourceSelection[];
  }>;
}
export interface ScopeRequest {
  workspaceId?: unknown;
  memberId?: unknown;
  write?: boolean;
}
export function externalFailure(
  error: unknown,
): Extract<ExternalCreation, { ok: false }> {
  return {
    ok: false,
    code:
      error instanceof DependencyError || error instanceof BridgeError
        ? error.code
        : "upstream_outcome_unknown",
    uncertain:
      error instanceof DependencyError || error instanceof BridgeError
        ? error.uncertain
        : true,
    ...(error instanceof BridgeError && error.requestId
      ? { requestId: error.requestId }
      : {}),
  };
}
export function createProjectFacade(
  workspaces: WorkspaceFacade,
  external: ExternalProjects,
  runtimeId: string,
) {
  async function scope(context: AuthContext, request: ScopeRequest = {}) {
    const directory = await workspaces.directory(context);
    const id =
      request.workspaceId ??
      directory.items.find((i) => i.workspaceType === "personal")?.workspaceId;
    const item = selectWorkspace(directory.items, id, request.memberId);
    const selected = await workspaces.selected(
      context,
      item.workspaceId,
      item.workspaceMemberId,
    );
    requireWorkspaceWrite(selected.context, request.write);
    return {
      ...selected,
      user: selected.identity.user,
      scope: {
        principalId: selected.identity.principalId,
        credentialRef: selected.identity.credentialRef,
        workspaceId: item.workspaceId,
      },
    };
  }
  async function project(
    context: AuthContext,
    id: string,
    request: ScopeRequest = {},
  ) {
    const value = await scope(context, request),
      p = await projectFor(value.user.id, id);
    workspaceFor(p, value.item.workspaceId);
    return { ...value, p };
  }
  async function conversation(
    context: AuthContext,
    pid: string,
    cid: string,
    request: ScopeRequest = {},
  ) {
    const value = await project(context, pid, request),
      { conversation: c } = await conversationFor(value.user.id, cid);
    requireConversationProject(c.project_id, pid);
    return { ...value, c };
  }
  async function createConversation(
    access: Awaited<ReturnType<typeof project>>,
    input: { id: string; title?: string | null },
  ) {
    const intent = await prepareConversation(
      access.user.id,
      access.p.id,
      access.scope.workspaceId,
      input,
    );
    if (!intent.execute) return intent.conversation;
    let result: ExternalCreation;
    try {
      const remote = await external.createSession(
        access.scope,
        intent.project.runtime_project_id!,
      );
      result =
        remote.project === intent.project.runtime_project_id
          ? { ok: true, id: remote.id }
          : { ok: false, code: "runtime_protocol_error", uncertain: true };
    } catch (error) {
      result = externalFailure(error);
    }
    return finishConversation(access.p.id, input.id, intent.token!, result);
  }
  return {
    scope,
    project,
    conversation,
    createConversation,
    external,
    async list(context: AuthContext, request: ScopeRequest = {}) {
      const access = await scope(context, request);
      return {
        ...access,
        projects: await listProjects(access.user.id, access.item.workspaceId),
      };
    },
    async create(
      context: AuthContext,
      input: unknown,
      request: ScopeRequest = {},
    ) {
      const access = await scope(context, { ...request, write: true });
      const prepared = await projectInput(access.user.id, access.item, input);
      if (prepared.selected.length)
        ensureRuntimeResources(
          await external.officialResources(access.scope),
          prepared.selected,
        );
      const intent = await prepareProject(access.user.id, {
        ...prepared,
        workspaceId: access.item.workspaceId,
        runtimeId,
      });
      let p = intent.project;
      if (intent.execute) {
        let outcome: ExternalCreation;
        try {
          outcome = {
            ok: true,
            id: (await external.createProject(access.scope, prepared.name)).id,
          };
        } catch (error) {
          outcome = externalFailure(error);
        }
        p = await finishProject(prepared.id, intent.token!, outcome);
      }
      ready(p);
      const c = await createConversation(
        { ...access, p },
        { id: prepared.conversationId },
      );
      ready(c);
      return { project: p, conversation: c };
    },
    async update(
      context: AuthContext,
      id: string,
      value: Record<string, unknown>,
      request: ScopeRequest = {},
    ) {
      const access = await project(context, id, { ...request, write: true });
      const metadata = { ...access.p.metadata_json };
      let base = (metadata.officialResources ?? []) as ResourceSelection[];
      for (const [field, type] of [
        ["skillId", "skill"],
        ["designSystemId", "design-system"],
      ] as const) {
        if (field in value) {
          if (value[field] !== null && typeof value[field] !== "string")
            throw new BizError("invalid_input");
          base = base.filter((r) => r.type !== type);
        }
      }
      const selected = await selectionsFor(value, {
        ...metadata,
        officialResources: base,
      });
      if (selected.selection.length)
        ensureRuntimeResources(
          await external.officialResources(access.scope),
          selected.selection,
        );
      return updateProject(access.user.id, id, access.scope.workspaceId, {
        metadata: { ...metadata, officialResources: selected.selection },
      });
    },
    async conversations(access: Awaited<ReturnType<typeof project>>) {
      return db.read().conversations.forProject(access.p.id);
    },
  };
}
export type ProjectFacade = ReturnType<typeof createProjectFacade>;
export type ProjectAccess = Awaited<ReturnType<ProjectFacade["project"]>>;
