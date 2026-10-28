import { z } from "zod";
import {
  workspaceDirectory,
  amrWorkspaceContext,
  amrMemberDirectory,
} from "./schemas/workspaces.js";
import {
  createApiRequest,
  workspacePath as workspace,
} from "./internal/api-http.js";
import type { AmrApiClientOptions } from "./types.js";
export function createAmrWorkspaceClient<Context>(
  options: AmrApiClientOptions<Context>,
) {
  const request = createApiRequest(options);
  return {
    directory: (context: Context) =>
      request(context, "/api/v1/workspaces", workspaceDirectory),
    context: (context: Context, id: string) =>
      request(context, "/api/v1/workspaces/current", amrWorkspaceContext, {
        headers: { "x-vela-workspace-id": id },
      }),
    members: (context: Context, id: string) =>
      request(context, workspace(id) + "/member-directory", amrMemberDirectory),
    invite: (
      context: Context,
      id: string,
      email: string,
      role: "admin" | "member",
    ) =>
      request(
        context,
        workspace(id) + "/invites",
        z.object({ id: z.string().min(1), workspaceId: z.string().min(1) }),
        { method: "POST", body: JSON.stringify({ invitedEmail: email, role }) },
      ),
  };
}
