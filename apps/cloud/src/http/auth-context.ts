import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { db, type AuthContext, type LoginProgress } from "@open-design/bridge";
const token = () => randomBytes(32).toString("hex");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const names = { client: "od-cloud-client", session: "od-cloud-session" };
function read(req: Request, name: string) {
  const value = (req.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export function createHttpIdentity(secure: boolean, now = Date.now) {
  function cookie(res: Response, name: string, value: string, seconds: number) {
    res.append(
      "Set-Cookie",
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`,
    );
  }
  return {
    async context(req: Request, res: Response): Promise<AuthContext> {
      if (res.locals.authContext) return res.locals.authContext as AuthContext;
      let clientRef = read(req, names.client);
      if (!clientRef) {
        clientRef = token();
        cookie(res, names.client, clientRef, 30 * 86400);
      }
      const bearer = read(req, names.session),
        session = bearer
          ? await db.read().browserSessions.get(hash(bearer))
          : null;
      const context: AuthContext = {
        clientRef,
        ...(session &&
        session.client_ref === clientRef &&
        Date.parse(session.expires_at) > now()
          ? { sessionRef: session.session_ref }
          : {}),
      };
      res.locals.authContext = context;
      return context;
    },
    async bind(
      res: Response,
      context: AuthContext,
      progress: Extract<LoginProgress, { status: "succeeded" }>,
    ) {
      const bearer = token();
      await db.transaction((tx) =>
        tx.browserSessions.insert({
          cookie_hash: hash(bearer),
          session_ref: progress.sessionRef,
          client_ref: context.clientRef,
          expires_at: progress.expiresAt,
        }),
      );
      cookie(
        res,
        names.session,
        bearer,
        Math.max(
          0,
          Math.floor((Date.parse(progress.expiresAt) - now()) / 1000),
        ),
      );
      res.locals.authContext = { ...context, sessionRef: progress.sessionRef };
    },
    async clear(req: Request, res: Response) {
      const bearer = read(req, names.session);
      if (bearer)
        await db.transaction((tx) => tx.browserSessions.remove(hash(bearer)));
      cookie(res, names.session, "", 0);
      res.locals.authContext = undefined;
    },
  };
}
export type HttpIdentity = ReturnType<typeof createHttpIdentity>;
