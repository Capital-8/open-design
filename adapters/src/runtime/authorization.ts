import { createHash } from "node:crypto";
import { BridgeError, type RuntimeScope } from "@open-design/bridge";
import { createAmrAuthorizationClient } from "@open-design/dependencies/amr";
import type { RuntimeCredentialSource } from "../auth/credentials.js";
import { callDependency } from "../internal/errors.js";

/** Internal to runtime: no public auth/runtime bridge method returns execution credentials. */
export function runtimeAuthorization(options: {
  apiUrl: string;
  credentials: RuntimeCredentialSource;
  fetch: typeof fetch;
  now: () => number;
}) {
  const client = createAmrAuthorizationClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
  });
  const grants = new Map<string, { token: string; expires: number }>();
  return async function getRuntimeAuthorization(
    scope: RuntimeScope,
    refresh = false,
  ): Promise<string> {
    if (!scope.principalId || !scope.workspaceId || !scope.credentialRef)
      throw new BridgeError("runtime_scope_required");
    for (const [key, grant] of grants)
      if (grant.expires <= options.now()) grants.delete(key);
    const credential = await options.credentials.resolve(
      scope.credentialRef,
      scope.principalId,
    );
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          scope.credentialRef,
          credential.revision,
          scope.principalId,
          scope.workspaceId,
        ]),
      )
      .digest("hex");
    const cached = grants.get(key);
    const current = async () =>
      credential.expiresAt > options.now() &&
      (await options.credentials.isCurrent(
        scope.credentialRef,
        credential.revision,
      ));
    if (!(await current()))
      throw new BridgeError("runtime_reauthentication_required");
    if (!refresh && cached && cached.expires > options.now() + 30000)
      return cached.token;
    grants.delete(key);
    const grant = await callDependency(() =>
      client.authorize(credential.controlKey, scope.workspaceId),
    );
    if (
      grant.actor !== credential.providerActorId ||
      grant.workspace !== scope.workspaceId
    )
      throw new BridgeError("runtime_authorization_invalid");
    if (!(await current()))
      throw new BridgeError("runtime_reauthentication_required");
    const expires = Math.min(Date.parse(grant.expires), credential.expiresAt);
    if (expires <= options.now() + 30000)
      throw new BridgeError("runtime_authorization_expired");
    if (grants.size >= 1024) grants.delete(grants.keys().next().value!);
    grants.set(key, { token: grant.token, expires });
    return grant.token;
  };
}
