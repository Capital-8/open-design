import { createHash, randomBytes } from "node:crypto";
import {
  BridgeError,
  type Auth,
  type AuthContext,
  type LoginAttempt,
  type LoginIdentity,
  type LoginProgress,
} from "@open-design/bridge";
import {
  createAmrAuthClient,
  type AmrProfile,
} from "@open-design/dependencies/amr";
import {
  callDependency,
  HttpFailure,
  protocolFetch,
  toBridgeError,
} from "../internal/errors.js";
import type { RuntimeCredentialSource } from "./credentials.js";
export type {
  RuntimeCredentialSource,
  RuntimeCredential,
} from "./credentials.js";

type Session = {
  clientRef: string;
  controlKey: string;
  principalId: string;
  expires: number;
  revision: string;
};
type Attempt = {
  clientRef: string;
  requestId: string;
  public: LoginAttempt;
  expires: number;
  deviceId: string;
  deviceSecret: string;
  controlKey?: string;
  progress: LoginProgress;
  nextPoll: number;
  polling?: Promise<void>;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("hex");
const identity = (profile: AmrProfile): LoginIdentity => ({
  id: profile.authUserId,
  email: profile.email,
  name: profile.name,
  ...(profile.image !== undefined ? { image: profile.image } : {}),
  accountStatus: profile.status,
});
export interface VelaAuthOptions {
  apiUrl: string;
  webUrl: string;
  profile: "test" | "prod";
  clientVersion: string;
  host: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** POC device login, without cookies, HTTP routes, workspace or billing business operations.
 * In-memory attempts/sessions preserve POC's single-process lifetime; app persistence is a separate decision.
 */
export function createVelaAuthAdapter(options: VelaAuthOptions): {
  adapter: Auth;
  credentials: RuntimeCredentialSource;
} {
  const client = createAmrAuthClient({
    apiUrl: options.apiUrl,
    webUrl: options.webUrl,
    fetch: protocolFetch(options.fetch ?? fetch),
  });
  const now = options.now ?? Date.now;
  const attempts = new Map<string, Attempt>(),
    sessions = new Map<string, Session>();
  const starting = new Map<
    string,
    { requestId: string; cancelled: boolean; promise: Promise<LoginAttempt> }
  >();
  const sessionLifetime = 8 * 60 * 60 * 1000;
  function context(value: AuthContext) {
    if (!value.clientRef || value.clientRef.length > 256)
      throw new BridgeError("invalid_auth_context");
  }
  function prune() {
    for (const [key, attempt] of attempts)
      if (attempt.expires <= now()) attempts.delete(key);
    for (const [key, session] of sessions)
      if (session.expires <= now()) sessions.delete(key);
  }
  function profile(controlKey: string) {
    return callDependency(() => client.getProfile(controlKey));
  }
  async function validSession(ref: string, expectedClient?: string) {
    prune();
    const key = hash(ref),
      session = sessions.get(key);
    if (
      !session ||
      (expectedClient !== undefined && session.clientRef !== expectedClient)
    )
      return null;
    try {
      const user = await profile(session.controlKey);
      // Recheck after I/O: logout must win over an in-flight profile response.
      if (sessions.get(key) !== session || session.expires <= now())
        return null;
      if (
        user.authUserId !== session.principalId ||
        ["deleting", "deleted"].includes(user.status)
      ) {
        sessions.delete(key);
        return null;
      }
      return { session, user };
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 401) {
        sessions.delete(key);
        return null;
      }
      throw error;
    }
  }
  function findAttempt(ctx: AuthContext, ref: string) {
    context(ctx);
    prune();
    const attempt = attempts.get(hash(ref));
    return attempt?.clientRef === ctx.clientRef ? attempt : undefined;
  }
  function cancel(attempt: Attempt) {
    attempt.progress = { status: "cancelled" };
    attempt.deviceSecret = "";
    attempt.controlKey = undefined;
  }
  async function advance(attempt: Attempt) {
    if (!attempt.controlKey) {
      const token = await callDependency(() =>
        client.pollDeviceAuthorization(attempt.deviceId, attempt.deviceSecret),
      );
      if (attempt.progress.status !== "pending" || attempt.expires <= now())
        return;
      if (token.status !== "approved") {
        attempt.progress =
          token.status === "consumed"
            ? { status: "failed", code: "login_consumed" }
            : { status: token.status };
        return;
      }
      if (!token.controlKey) throw new BridgeError("auth_protocol_error");
      // A consumed device token cannot be requested twice after a transient /me failure.
      attempt.deviceSecret = "";
      attempt.controlKey = token.controlKey;
    }
    const user = await profile(attempt.controlKey);
    if (
      attempt.progress.status !== "pending" ||
      attempt.expires <= now() ||
      attempts.get(hash(attempt.public.attemptRef)) !== attempt
    )
      return;
    if (user.status !== "active") {
      attempt.progress = { status: "failed", code: "account_restricted" };
      attempt.controlKey = undefined;
      return;
    }
    prune();
    if (sessions.size >= 1024) throw new BridgeError("auth_capacity");
    const sessionRef = opaque(),
      expires = now() + sessionLifetime;
    sessions.set(hash(sessionRef), {
      clientRef: attempt.clientRef,
      controlKey: attempt.controlKey,
      principalId: user.authUserId,
      expires,
      revision: opaque(),
    });
    attempt.controlKey = undefined;
    attempt.progress = {
      status: "succeeded",
      sessionRef,
      credentialRef: sessionRef,
      identity: identity(user),
      expiresAt: new Date(expires).toISOString(),
    };
  }
  const adapter: Auth = {
    async getLoginState(ctx) {
      context(ctx);
      if (!ctx.sessionRef) return { status: "signed-out" };
      const found = await validSession(ctx.sessionRef, ctx.clientRef);
      return found
        ? {
            status: "signed-in",
            credentialRef: ctx.sessionRef,
            identity: identity(found.user),
            expiresAt: new Date(found.session.expires).toISOString(),
          }
        : { status: "expired" };
    },
    async startLogin(ctx, input) {
      context(ctx);
      prune();
      if (!input.requestId || input.requestId.length > 128)
        throw new BridgeError("invalid_login_request");
      const pending = starting.get(ctx.clientRef);
      if (pending) {
        if (pending.requestId !== input.requestId)
          throw new BridgeError("login_in_progress");
        return pending.promise;
      }
      for (const attempt of attempts.values()) {
        if (
          attempt.clientRef === ctx.clientRef &&
          attempt.progress.status === "pending"
        )
          return { ...attempt.public };
      }
      if (attempts.size + starting.size >= 256)
        throw new BridgeError("auth_capacity");
      const ticket = {
        requestId: input.requestId,
        cancelled: false,
        promise: undefined as unknown as Promise<LoginAttempt>,
      };
      ticket.promise = (async () => {
        const data = await callDependency(() =>
          client.createDeviceAuthorization({
            cliVersion: options.clientVersion,
            host: options.host,
            profile: options.profile,
          }),
        );
        if (ticket.cancelled) throw new BridgeError("login_cancelled");
        try {
          client.validateActivation(data);
        } catch (error) {
          throw toBridgeError(error);
        }
        const expires = Math.min(
          Date.parse(data.expiresAt),
          now() + 15 * 60000,
        );
        if (expires <= now()) throw new BridgeError("auth_protocol_error");
        const attemptRef = opaque();
        const publicData: LoginAttempt = {
          attemptRef,
          activationUrl: data.activationUrl,
          userCode: data.userCode,
          expiresAt: new Date(expires).toISOString(),
          pollIntervalSeconds: data.pollIntervalSeconds,
        };
        attempts.set(hash(attemptRef), {
          clientRef: ctx.clientRef,
          requestId: input.requestId,
          public: publicData,
          expires,
          deviceId: data.deviceId,
          deviceSecret: data.deviceSecret,
          progress: { status: "pending" },
          nextPoll: now() + data.pollIntervalSeconds * 1000,
        });
        return { ...publicData };
      })().finally(() => {
        if (starting.get(ctx.clientRef) === ticket)
          starting.delete(ctx.clientRef);
      });
      starting.set(ctx.clientRef, ticket);
      return ticket.promise;
    },
    async pollLogin(ctx, ref) {
      const attempt = findAttempt(ctx, ref);
      if (!attempt) return { status: "expired" };
      if (
        attempt.progress.status === "pending" &&
        !attempt.polling &&
        now() >= attempt.nextPoll
      ) {
        attempt.nextPoll = now() + attempt.public.pollIntervalSeconds * 1000;
        attempt.polling = advance(attempt).finally(() => {
          attempt.polling = undefined;
        });
      }
      if (attempt.polling) await attempt.polling;
      if (attempt.expires <= now()) return { status: "expired" };
      if (
        attempt.progress.status === "succeeded" &&
        !sessions.has(hash(attempt.progress.sessionRef))
      )
        return { status: "expired" };
      return structuredClone(attempt.progress);
    },
    async cancelLogin(ctx, ref) {
      const attempt = findAttempt(ctx, ref);
      if (!attempt || attempt.progress.status !== "pending")
        return { cancelled: false };
      cancel(attempt);
      return { cancelled: true };
    },
    async logout(ctx) {
      context(ctx);
      if (ctx.sessionRef) {
        const key = hash(ctx.sessionRef);
        if (sessions.get(key)?.clientRef === ctx.clientRef)
          sessions.delete(key);
      }
      const ticket = starting.get(ctx.clientRef);
      if (ticket) ticket.cancelled = true;
      for (const attempt of attempts.values()) {
        if (attempt.clientRef !== ctx.clientRef) continue;
        if (attempt.progress.status === "succeeded")
          sessions.delete(hash(attempt.progress.sessionRef));
        cancel(attempt);
      }
    },
  };
  const credentials: RuntimeCredentialSource = {
    async resolve(ref, principalId) {
      const found = await validSession(ref);
      if (!found || found.session.principalId !== principalId)
        throw new BridgeError("runtime_reauthentication_required");
      if (found.user.status !== "active")
        throw new BridgeError("account_restricted");
      return {
        controlKey: found.session.controlKey,
        providerActorId: found.user.id,
        expiresAt: found.session.expires,
        revision: found.session.revision,
      };
    },
    isCurrent(ref, revision) {
      const session = sessions.get(hash(ref));
      return (
        !!session && session.revision === revision && session.expires > now()
      );
    },
  };
  return { adapter, credentials };
}

export { createPersistentVelaAuthAdapter } from "./persistent.js";
export type { CredentialKeyring } from "./session-store.js";
