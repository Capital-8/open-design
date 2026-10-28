import type { AuthContext } from "@open-design/bridge";
import type {
  createAmrWorkspaceClient,
  createAmrBillingClient,
} from "@open-design/dependencies/amr";
import { HttpFailure } from "@open-design/dependencies";
import {
  accessibleMemberships,
  selectWorkspace,
  workspaceContext,
  activeWorkspace,
  allowInvite,
} from "@open-design/biz/workspaces";
import { billingProjection } from "@open-design/biz/billing";
import { BizError } from "@open-design/biz/errors";
import type { AccountFacade, CloudIdentity } from "../account/index.js";
export interface WorkspaceClients {
  workspaces: ReturnType<typeof createAmrWorkspaceClient<CloudIdentity>>;
  billing: ReturnType<typeof createAmrBillingClient<CloudIdentity>>;
}
export function createWorkspaceFacade(
  account: AccountFacade,
  client: WorkspaceClients,
  options: { webUrl: string; modelId: string | null; now?: () => number },
) {
  const now = options.now ?? Date.now;
  async function call<T>(
    identity: CloudIdentity,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 401) {
        throw new BizError("unauthorized");
      }
      throw error;
    }
  }
  async function directory(context: AuthContext) {
    const identity = await account.current(context);
    const result = await call(identity, () =>
      client.workspaces.directory(identity),
    );
    return {
      identity,
      items: accessibleMemberships(identity.user, result.items),
    };
  }
  async function selected(context: AuthContext, id: unknown, member?: unknown) {
    const { identity, items } = await directory(context),
      item = selectWorkspace(items, id, member);
    const value = await call(identity, () =>
      client.workspaces.context(identity, item.workspaceId),
    );
    const url = new URL(options.webUrl + "/settings");
    url.searchParams.set("workspaceId", item.workspaceId);
    url.searchParams.set("source", "open_design");
    return {
      identity,
      item,
      context: workspaceContext(identity.user, item, value, url.toString()),
    };
  }
  async function billing(
    context: AuthContext,
    workspaceId: unknown,
    memberId?: unknown,
  ) {
    const { identity, items } = await directory(context),
      item = selectWorkspace(items, workspaceId, memberId);
    activeWorkspace(item);
    const [projection, preflight] = await Promise.all([
      call(identity, () => client.billing.snapshot(identity, item.workspaceId))
        .then((snapshot) => ({ snapshot, balance: null }))
        .catch(async (error) => {
          if (
            !(error instanceof HttpFailure) ||
            ![404, 405, 501].includes(error.status)
          )
            throw error;
          return {
            snapshot: null,
            balance: await call(identity, () =>
              client.billing.balance(identity, item.workspaceId),
            ),
          };
        }),
      call(identity, () =>
        client.billing.preflight(identity, item.workspaceId, options.modelId),
      ),
    ]);
    return billingProjection(
      item,
      { ...projection, preflight },
      options.modelId,
      now(),
    );
  }
  return {
    directory,
    selected,
    billing,
    async summary(context: AuthContext) {
      const identity = await account.current(context);
      return call(identity, () => client.billing.summary(identity));
    },
    async members(context: AuthContext, id: unknown, member: unknown) {
      const value = await selected(context, id, member);
      if (value.context.workspaceType !== "team") return { members: [] };
      const result = await call(value.identity, () =>
        client.workspaces.members(value.identity, value.item.workspaceId),
      );
      if (result.workspaceId !== value.item.workspaceId)
        throw new BizError("workspace_unavailable");
      return {
        members: result.members.map((m) => ({
          memberId: m.id,
          displayName: m.displayLabel,
          role: m.role,
        })),
      };
    },
    async invite(
      context: AuthContext,
      id: unknown,
      member: unknown,
      invites: { email: string; role: "admin" | "member" }[],
    ) {
      const value = await selected(context, id, member);
      allowInvite(value.context);
      const results = [];
      for (const invite of invites) {
        try {
          const result = await call(value.identity, () =>
            client.workspaces.invite(
              value.identity,
              value.item.workspaceId,
              invite.email,
              invite.role,
            ),
          );
          if (result.workspaceId !== value.item.workspaceId)
            throw new BizError("workspace_unavailable");
          results.push({ email: invite.email, ok: true, inviteId: result.id });
        } catch (error) {
          if (error instanceof BizError && error.code === "unauthorized")
            throw error;
          const aliases: Record<string, string> = {
            invite_existing_member: "already_member",
            invite_duplicate: "active_pending_invite",
          };
          results.push({
            email: invite.email,
            ok: false,
            error:
              error instanceof HttpFailure
                ? (aliases[error.code] ??
                  (error.code === "vela_upstream_error"
                    ? "create_" + error.status
                    : error.code))
                : "create_503",
          });
        }
      }
      return { results };
    },
  };
}
export type WorkspaceFacade = ReturnType<typeof createWorkspaceFacade>;
