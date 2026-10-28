import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { legacyPrivacyChoice } from "@open-design/contracts/cloud/legacy-app-config";
import { BizError } from "@open-design/biz/errors";
import type { AccountFacade } from "../facades/account/index.js";
import type { HttpIdentity } from "../http/auth-context.js";
import { jsonBody } from "../http/input.js";
export function accountRoutes(
  app: Express,
  facade: AccountFacade,
  http: HttpIdentity,
  options: { profile: "test" | "prod"; webUrl: string },
) {
  const attempts = new Map<
    string,
    {
      ref: string;
      authAttemptId: string;
      authRequestId: string;
      activationUrl: string;
      expires: number;
    }
  >();
  async function poll(req: Request, res: Response) {
    const context = await http.context(req, res),
      attempt = attempts.get(context.clientRef);
    if (!attempt || attempt.expires <= Date.now()) {
      attempts.delete(context.clientRef);
      return { status: "expired" };
    }
    const progress = await facade.poll(context, attempt.ref);
    if (progress.status === "succeeded") {
      await http.bind(res, context, progress);
      attempts.delete(context.clientRef);
      return { status: "approved", authAttemptId: attempt.authAttemptId };
    }
    return {
      status: progress.status === "failed" ? "cancelled" : progress.status,
      authAttemptId: attempt.authAttemptId,
      activationUrl: attempt.activationUrl,
    };
  }
  async function status(req: Request, res: Response) {
    const flow = await poll(req, res);
    let identity;
    try {
      identity = await facade.current(await http.context(req, res));
    } catch (error) {
      if (
        !(error instanceof BizError) ||
        !["unauthorized", "account_restricted"].includes(error.code)
      )
        throw error;
    }
    return {
      loggedIn: !!identity,
      sessionState: identity ? "authenticated" : "signed_out",
      loginInFlight: !identity && flow.status === "pending",
      profile: options.profile,
      configPath: "",
      user: identity
        ? {
            id: identity.user.id,
            email: identity.user.email,
            name: identity.user.name,
            image: identity.user.image,
          }
        : null,
      ...("authAttemptId" in flow ? { authAttemptId: flow.authAttemptId } : {}),
      ...(flow.status === "pending"
        ? { activationUrl: flow.activationUrl, browserOpenFailed: false }
        : {}),
    };
  }
  async function start(req: Request, res: Response, legacy: boolean) {
    const context = await http.context(req, res),
      body = jsonBody(req),
      authAttemptId = body.authAttemptId ?? randomUUID(),
      authRequestId = body.authRequestId ?? String(authAttemptId);
    if (
      typeof authAttemptId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(authAttemptId) ||
      typeof authRequestId !== "string" ||
      authRequestId.length > 128
    )
      throw new BizError("invalid_login_request");
    const result = await facade.start(context, authRequestId);
    attempts.set(context.clientRef, {
      ref: result.attemptRef,
      authAttemptId,
      authRequestId,
      activationUrl: result.activationUrl,
      expires: Date.parse(result.expiresAt),
    });
    const output = {
      activationUrl: result.activationUrl,
      userCode: result.userCode,
      expiresAt: result.expiresAt,
      pollIntervalSeconds: result.pollIntervalSeconds,
      authAttemptId,
    };
    res
      .status(legacy ? 202 : 200)
      .json(
        legacy
          ? {
              ok: true,
              loginInFlight: true,
              browserOpenFailed: false,
              ...output,
            }
          : output,
      );
  }
  async function cancel(req: Request, res: Response) {
    const context = await http.context(req, res),
      attempt = attempts.get(context.clientRef),
      input = jsonBody(req);
    if (
      !attempt ||
      (input.authAttemptId && input.authAttemptId !== attempt.authAttemptId) ||
      (input.authRequestId && input.authRequestId !== attempt.authRequestId)
    ) {
      res.json({ ok: true, canceled: false });
      return;
    }
    const result = await facade.cancel(context, attempt.ref);
    attempts.delete(context.clientRef);
    res.json({ ok: true, canceled: result.cancelled });
  }
  async function logout(req: Request, res: Response) {
    const context = await http.context(req, res);
    await facade.logout(context);
    attempts.delete(context.clientRef);
    await http.clear(req, res);
    res.json({
      ok: true,
      success: true,
      loggedIn: false,
      sessionState: "signed_out",
    });
  }
  app.get("/api/auth/providers", (_req, res) =>
    res.json({
      providers: [],
      emailPasswordOnly: false,
      vela: { profile: options.profile, webUrl: options.webUrl },
      turnstile: { enabled: false },
    }),
  );
  app.post("/api/auth/vela/start", (req, res) => start(req, res, false));
  app.post("/api/integrations/vela/login", async (req, res) => {
    const current = await status(req, res);
    if (current.loggedIn) {
      res.json({ ok: true, ...current });
      return;
    }
    if (current.loginInFlight) {
      res.status(409).json({ ...current, error: "Login already in progress" });
      return;
    }
    await start(req, res, true);
  });
  app.post("/api/auth/vela/poll", async (req, res) =>
    res.json(await poll(req, res)),
  );
  app.get("/api/integrations/vela/status", async (req, res) =>
    res.json(await status(req, res)),
  );
  app.post(
    ["/api/auth/vela/cancel", "/api/integrations/vela/login/cancel"],
    cancel,
  );
  app.post(["/api/auth/sign-out", "/api/integrations/vela/logout"], logout);
  app.get(["/api/me", "/api/auth/get-session"], async (req, res) => {
    try {
      const value = await facade.current(await http.context(req, res));
      res.json({ user: value.user, session: { expiresAt: value.expiresAt } });
    } catch (error) {
      if (
        req.path === "/api/auth/get-session" &&
        error instanceof BizError &&
        error.code === "unauthorized"
      ) {
        res.json(null);
        return;
      }
      throw error;
    }
  });
  app.get("/api/app-config", async (req, res) => {
    const state = await status(req, res);
    const privacy = state.loggedIn
      ? await facade.privacy(await http.context(req, res))
      : {};
    res.json({
      config: {
        agentId: "amr",
        onboardingCompleted: state.loggedIn,
        agentCliEnv: { amr: { OPEN_DESIGN_AMR_PROFILE: options.profile } },
        ...privacy,
      },
    });
  });
  app.put("/api/app-config", async (req, res) => {
    const context = await http.context(req, res),
      body = jsonBody(req);
    await facade.current(context);
    let privacy = await facade.privacy(context);
    if (body.privacyDecisionAt !== undefined) {
      const parsed = legacyPrivacyChoice.safeParse(body);
      if (!parsed.success) throw new BizError("invalid_privacy_choice");
      privacy = await facade.savePrivacy(context, parsed.data);
    }
    res.json({
      config: {
        agentId: "amr",
        onboardingCompleted: true,
        agentCliEnv: { amr: { OPEN_DESIGN_AMR_PROFILE: options.profile } },
        ...privacy,
      },
      unsupportedFields: Object.keys(body).filter(
        (key) =>
          !["privacyDecisionAt", "installationId", "telemetry"].includes(key),
      ),
    });
  });
  return { status };
}
