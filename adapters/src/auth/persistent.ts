import { randomBytes } from "node:crypto";
import {
  BridgeError,
  type Auth,
  type AuthContext,
  type Db,
  type LoginIdentity,
  type LoginProgress,
  type CredentialRecord,
} from "@open-design/bridge";
import { createAmrAuthClient } from "@open-design/dependencies/amr";
import { createVelaAuthAdapter, type VelaAuthOptions } from "./index.js";
import {
  createAuthSessionStore,
  type CredentialKeyring,
} from "./session-store.js";
import type { RuntimeCredentialSource } from "./credentials.js";
import {
  callDependency,
  HttpFailure,
  protocolFetch,
} from "../internal/errors.js";
const opaque = () => randomBytes(32).toString("hex");
/** Device attempts are ephemeral; completed login/session/credential associations are durable. */
export function createPersistentVelaAuthAdapter(
  options: VelaAuthOptions & {
    database: Db;
    environment: string;
    keyring: CredentialKeyring;
  },
) {
  const volatile = createVelaAuthAdapter(options),
    store = createAuthSessionStore(
      options.database,
      options.environment,
      options.keyring,
    );
  const client = createAmrAuthClient({
    apiUrl: options.apiUrl,
    webUrl: options.webUrl,
    fetch: protocolFetch(options.fetch ?? fetch),
  });
  const now = options.now ?? Date.now,
    epochs = new Map<string, number>();
  const completed = new Map<
    string,
    {
      clientRef: string;
      expires: number;
      sessionRef: string;
      credentialRef: string;
      revision: string;
      epoch: number;
      pending?: Promise<LoginProgress>;
    }
  >();
  function valid(
    record: CredentialRecord | null,
    principal?: string,
  ): record is CredentialRecord {
    return (
      !!record &&
      record.environment === options.environment &&
      (!principal || record.principal_id === principal) &&
      !record.revoked_at &&
      Date.parse(record.expires_at) > now()
    );
  }
  async function current(ref: string, revision: string) {
    const record = await store.credential(ref);
    return valid(record) && record.revision === revision;
  }
  async function credential(ref: string, principal: string) {
    const record = await store.credential(ref);
    if (!valid(record, principal))
      throw new BridgeError("runtime_reauthentication_required");
    const secret = store.decrypt(record);
    let profile;
    try {
      profile = await callDependency(() => client.getProfile(secret));
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 401) {
        await options.database.transaction((tx) =>
          tx.credentials.revoke(record.id, new Date(now()).toISOString()),
        );
        throw new BridgeError("runtime_reauthentication_required");
      }
      throw error;
    }
    if (
      profile.authUserId !== record.principal_id ||
      profile.id !== record.provider_actor_id ||
      ["deleting", "deleted"].includes(profile.status)
    ) {
      await options.database.transaction((tx) =>
        tx.credentials.revoke(record.id, new Date(now()).toISOString()),
      );
      throw new BridgeError("runtime_reauthentication_required");
    }
    if (!(await current(record.id, record.revision)))
      throw new BridgeError("runtime_reauthentication_required");
    return { record, secret, profile };
  }
  const credentials: RuntimeCredentialSource = {
    async resolve(ref, principal) {
      const found = await credential(ref, principal);
      if (found.profile.status !== "active")
        throw new BridgeError("account_restricted");
      return {
        controlKey: found.secret,
        providerActorId: found.profile.id,
        revision: found.record.revision,
        expiresAt: Date.parse(found.record.expires_at),
      };
    },
    isCurrent: current,
  };
  const identity = (
    profile: Awaited<ReturnType<typeof client.getProfile>>,
  ): LoginIdentity => ({
    id: profile.authUserId,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    accountStatus: profile.status,
  });
  const adapter: Auth = {
    async getLoginState(context) {
      if (!context.clientRef || context.clientRef.length > 256)
        throw new BridgeError("invalid_auth_context");
      if (!context.sessionRef) return { status: "signed-out" };
      const session = await store.session(context.sessionRef);
      if (
        !session ||
        session.client_ref !== context.clientRef ||
        session.revoked_at ||
        Date.parse(session.expires_at) <= now()
      )
        return { status: "expired" };
      try {
        const found = await credential(
          session.credential_ref,
          session.principal_id,
        );
        const again = await store.session(context.sessionRef);
        if (
          !again ||
          again.revoked_at ||
          again.revision !== session.revision ||
          Date.parse(again.expires_at) <= now()
        )
          return { status: "expired" };
        return {
          status: "signed-in",
          identity: identity(found.profile),
          expiresAt: session.expires_at,
          credentialRef: session.credential_ref,
        };
      } catch (error) {
        if (
          error instanceof BridgeError &&
          error.code === "runtime_reauthentication_required"
        )
          return { status: "expired" };
        throw error;
      }
    },
    startLogin: (context, input) => volatile.adapter.startLogin(context, input),
    async pollLogin(context, ref) {
      for (const [key, value] of completed)
        if (value.expires <= now()) completed.delete(key);
      const progress = await volatile.adapter.pollLogin(context, ref);
      if (progress.status !== "succeeded") return progress;
      let ticket = completed.get(ref);
      if (!ticket) {
        ticket = {
          clientRef: context.clientRef,
          expires: Date.parse(progress.expiresAt),
          sessionRef: opaque(),
          credentialRef: opaque(),
          revision: opaque(),
          epoch: epochs.get(context.clientRef) ?? 0,
        };
        completed.set(ref, ticket);
      }
      if (ticket.clientRef !== context.clientRef) return { status: "expired" };
      if (ticket.pending) return ticket.pending;
      const fixed = ticket;
      fixed.pending = (async (): Promise<LoginProgress> => {
        const source = await volatile.credentials.resolve(
          progress.credentialRef,
          progress.identity.id,
        );
        await store.save(
          fixed.sessionRef,
          {
            client_ref: context.clientRef,
            principal_id: progress.identity.id,
            credential_ref: fixed.credentialRef,
            expires_at: progress.expiresAt,
            revoked_at: null,
            revision: fixed.revision,
          },
          {
            id: fixed.credentialRef,
            principal_id: progress.identity.id,
            provider_actor_id: source.providerActorId,
            expires_at: progress.expiresAt,
            revoked_at: null,
            revision: fixed.revision,
          },
          source.controlKey,
        );
        if (fixed.epoch !== (epochs.get(context.clientRef) ?? 0)) {
          await store.revoke(fixed.sessionRef, now());
          return { status: "cancelled" };
        }
        const session = await store.session(fixed.sessionRef);
        if (
          !session ||
          session.revoked_at ||
          !(await current(fixed.credentialRef, fixed.revision))
        )
          return { status: "expired" };
        return {
          ...progress,
          sessionRef: fixed.sessionRef,
          credentialRef: fixed.credentialRef,
        };
      })().finally(() => {
        fixed.pending = undefined;
      });
      return fixed.pending;
    },
    cancelLogin: (context, ref) => volatile.adapter.cancelLogin(context, ref),
    async logout(context: AuthContext) {
      const persisted = context.sessionRef
        ? await store.session(context.sessionRef)
        : null;
      epochs.set(context.clientRef, (epochs.get(context.clientRef) ?? 0) + 1);
      await volatile.adapter.logout(context);
      if (context.sessionRef) {
        const session = await store.session(context.sessionRef);
        if (session?.client_ref === context.clientRef)
          await store.revoke(context.sessionRef, now());
      }
      for (const value of completed.values())
        if (value.clientRef === context.clientRef)
          await store.revoke(value.sessionRef, now());
      if (persisted?.client_ref === context.clientRef)
        return {
          principalId: persisted.principal_id,
          credentialRef: persisted.credential_ref,
        };
    },
  };
  return { adapter, credentials };
}
