import { expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { database } from "./db/database.js";
import { createPersistentVelaAuthAdapter } from "../src/auth/persistent.js";
const user = {
  id: "provider",
  authUserId: "user",
  email: "u@example.test",
  name: "User",
  image: null,
  status: "active",
};
it("restores encrypted sessions after adapter restart, checks revocation during profile I/O, and keeps secrets private", async () => {
  const d = await database();
  try {
    let clock = Date.now();
    const getProfile = vi.fn(async () => Response.json(user));
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/v1/me") return getProfile();
      if (path.endsWith("/token"))
        return Response.json({
          status: "approved",
          controlKey: "private-persisted-control-key",
        });
      return Response.json({
        deviceId: "device",
        deviceSecret: "private-device-secret",
        userCode: "CODE",
        activationUrl:
          "https://login.test/cli/activate?deviceId=device&userCode=CODE",
        expiresAt: new Date(clock + 60000).toISOString(),
        pollIntervalSeconds: 1,
      });
    });
    const options = {
      apiUrl: "https://api.test",
      webUrl: "https://login.test",
      profile: "test" as const,
      clientVersion: "test",
      host: "test",
      fetch: fetcher,
      now: () => clock,
      database: d.db,
      environment: "test",
      keyring: { active: "v1", keys: { v1: randomBytes(32) } },
    };
    const first = createPersistentVelaAuthAdapter(options),
      ctx = { clientRef: "browser" };
    const attempt = await first.adapter.startLogin(ctx, {
      requestId: "request",
    });
    clock += 1000;
    const progress = await first.adapter.pollLogin(ctx, attempt.attemptRef);
    expect(progress.status).toBe("succeeded");
    if (progress.status !== "succeeded") throw Error("login");
    expect(progress.credentialRef).not.toBe(progress.sessionRef);
    expect(JSON.stringify(progress)).not.toContain("private-");
    const stored = await d.db.read().credentials.get(progress.credentialRef);
    expect(JSON.stringify(stored)).not.toContain("private-");
    const next = createPersistentVelaAuthAdapter(options),
      context = { ...ctx, sessionRef: progress.sessionRef };
    expect(await next.adapter.getLoginState(context)).toMatchObject({
      status: "signed-in",
      identity: { id: "user" },
    });
    expect(
      await next.adapter.getLoginState({ ...context, clientRef: "other" }),
    ).toEqual({ status: "expired" });
    expect(
      await next.credentials.resolve(progress.credentialRef, "user"),
    ).toMatchObject({ controlKey: "private-persisted-control-key" });
    await expect(
      next.credentials.resolve(progress.credentialRef, "other"),
    ).rejects.toMatchObject({ code: "runtime_reauthentication_required" });
    getProfile.mockRejectedValueOnce(Error("offline"));
    await expect(next.adapter.getLoginState(context)).rejects.toMatchObject({
      code: "auth_unavailable",
    });
    expect(await next.adapter.getLoginState(context)).toMatchObject({
      status: "signed-in",
    });
    const wrong = createPersistentVelaAuthAdapter({
      ...options,
      keyring: { active: "v2", keys: { v2: randomBytes(32) } },
    });
    await expect(wrong.adapter.getLoginState(context)).rejects.toMatchObject({
      code: "auth_key_unavailable",
    });
    let release!: (response: Response) => void;
    getProfile.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const pending = next.adapter.getLoginState(context);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    await first.adapter.logout(context);
    release(Response.json(user));
    expect(await pending).toEqual({ status: "expired" });
    expect(
      await next.credentials.isCurrent(
        progress.credentialRef,
        stored!.revision,
      ),
    ).toBe(false);
    expect(await next.adapter.getLoginState(context)).toEqual({
      status: "expired",
    });
  } finally {
    await d.close();
  }
}, 30000);
