import { db, type AuthContext, type RunRecord } from "@open-design/bridge";
import { runInput, runContext } from "@open-design/biz/runs/input";
import {
  requestBlockedRecovery,
  conversationEvents,
  existingRun,
  submitRun,
  cancelRun,
  requestDigest,
  snapshot,
  saveDraft,
} from "@open-design/biz/runs";
import { runFor, conversationFor } from "@open-design/biz/access";
import {
  Attachments,
  attachmentPrompt,
} from "@open-design/biz/files/attachments";
import { composeStrategyInput } from "@open-design/biz/prompts/strategy";
import {
  selectionsFor,
  ensureRuntimeResources,
  resourcePrompt,
} from "@open-design/biz/catalog/selection";
import { reauthorizeTask } from "@open-design/biz/runs/recovery";
import { BizError } from "@open-design/biz/errors";
import type { ProjectFacade, ScopeRequest } from "../projects/index.js";
import type { WorkspaceFacade } from "../workspaces/index.js";
export function createRunFacade(
  projects: ProjectFacade,
  workspaces: WorkspaceFacade,
  now = Date.now,
) {
  async function run(
    context: AuthContext,
    id: string,
    request: ScopeRequest = {},
  ) {
    const selected = await projects.scope(context, request),
      value = await runFor(selected.user.id, id);
    const access = await projects.project(context, value.project.id, request);
    return { ...access, r: value.run, c: value.conversation };
  }
  return {
    run,
    async events(
      context: AuthContext,
      id: string,
      cursor: string,
      request: ScopeRequest = {},
    ) {
      const a = await this.snapshot(context, id, request);
      return conversationEvents(a.project.owner_id, id, cursor);
    },
    async resumeEligible(context: AuthContext) {
      const directory = await workspaces.directory(context);
      for (const item of await db.read().runs.unfinished()) {
        if (
          item.principal_id !== directory.identity.principalId ||
          item.provider_environment !== directory.identity.environment ||
          item.authorization_state !== "waiting" ||
          item.cancel_requested
        )
          continue;
        try {
          const access = await workspaces.selected(context, item.workspace_id);
          if (
            access.context.lifecycleState !== "active" ||
            !access.context.permissions.canWriteSyncedFiles
          )
            continue;
          await reauthorizeTask({
            runId: item.id,
            principalId: access.identity.principalId,
            environment: access.identity.environment,
            workspaceId: access.item.workspaceId,
            credentialRef: access.identity.credentialRef,
          });
        } catch {
          /* Other workspaces may be unavailable. The durable waiting state stays intact. */
        }
      }
    },
    async submit(
      context: AuthContext,
      input: unknown,
      request: ScopeRequest = {},
    ) {
      const v = runInput(input);
      const access = await projects.conversation(
        context,
        v.projectId,
        v.conversationId,
        { ...request, write: true },
      );
      const original = v.currentPrompt ?? v.message,
        hash = requestDigest(v);
      const existing = await existingRun(
        access.user.id,
        v.conversationId,
        v.clientRequestId,
        original,
        hash,
      );
      if (existing) return existing;
      if (await requestBlockedRecovery(access.user.id, access.p.id))
        throw new BizError(
          "recovery_pending",
          "Previous run recovery is pending",
          true,
        );
      const selected = await selectionsFor(v, access.p.metadata_json);
      if (selected.selection.length)
        ensureRuntimeResources(
          await projects.external.officialResources(access.scope),
          selected.selection,
        );
      const hasStrategy = runContext(v, access.p);
      const attachments = await new Attachments().textContext(
        access.user,
        access.p.id,
        v.attachments ?? [],
        db.read(),
      );
      const composed = hasStrategy
        ? await composeStrategyInput(
            access.p,
            access.c,
            original,
            {
              priorTranscript: v.priorTranscript,
              locale: v.locale,
              context: v.context,
            },
            attachments,
          )
        : attachments.length
          ? attachmentPrompt(original, attachments)
          : original;
      await workspaces.billing(
        context,
        access.item.workspaceId,
        access.item.workspaceMemberId,
      );
      return submitRun(
        access.user.id,
        {
          conversationId: access.c.id,
          clientRequestId: v.clientRequestId,
          original,
          modelInput: resourcePrompt(
            composed,
            selected.selection,
            selected.inputs,
          ),
          requestHash: hash,
          legacy: {
            userMessageId: v.userMessageId,
            assistantMessageId: v.assistantMessageId,
            officialResources: selected.selection,
            officialPluginInputs: selected.inputs,
            ...(v.mediaExecution ? { mediaExecution: v.mediaExecution } : {}),
            ...(v.attachments ? { attachments: v.attachments } : {}),
          },
          scope: access.scope,
          environment: access.identity.environment,
          projectRevision: access.p.revision,
          conversationRevision: access.c.revision,
          admission: {
            principalId: access.user.id,
            workspaceId: access.item.workspaceId,
            workspaceMemberId: access.item.workspaceMemberId,
            checkedAt: now(),
          },
        },
        now(),
      );
    },
    async cancel(context: AuthContext, id: string, request: ScopeRequest = {}) {
      const a = await run(context, id, { ...request, write: true });
      return cancelRun(a.user.id, id);
    },
    async snapshot(
      context: AuthContext,
      cid: string,
      request: ScopeRequest = {},
    ) {
      const selected = await projects.scope(context, request),
        a = await conversationFor(selected.user.id, cid);
      await projects.project(context, a.project.id, request);
      return snapshot(selected.user.id, cid);
    },
    async draft(
      context: AuthContext,
      pid: string,
      cid: string,
      id: string,
      content: string,
      request: ScopeRequest = {},
    ) {
      const a = await projects.conversation(context, pid, cid, {
        ...request,
        write: true,
      });
      return saveDraft(a.user.id, cid, id, content);
    },
    async list(
      context: AuthContext,
      request: ScopeRequest = {},
      pid?: string,
      cid?: string,
    ) {
      const access = await projects.list(context, request),
        out: { run: RunRecord; projectId: string }[] = [];
      if (pid) await projects.project(context, pid, request);
      if (cid) await this.snapshot(context, cid, request);
      for (const p of access.projects) {
        if (pid && p.id !== pid) continue;
        for (const c of await db.read().conversations.forProject(p.id)) {
          if (cid && c.id !== cid) continue;
          for (const r of await db.read().runs.forConversation(c.id))
            out.push({ run: r, projectId: p.id });
        }
      }
      return out
        .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at))
        .slice(0, 100);
    },
    async reauthorize(
      context: AuthContext,
      id: string,
      request: ScopeRequest = {},
    ) {
      const a = await run(context, id, { ...request, write: true });
      return reauthorizeTask({
        runId: id,
        principalId: a.user.id,
        workspaceId: a.item.workspaceId,
        environment: a.identity.environment,
        credentialRef: a.scope.credentialRef,
      });
    },
  };
}
export type RunFacade = ReturnType<typeof createRunFacade>;
