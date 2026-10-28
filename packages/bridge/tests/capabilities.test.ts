import { fileFixture, reference } from "./file-fixture.js";
import { dbFixture } from "./db-fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth, BridgeBindings, Render, Runtime } from "../src/index.js";

function base(): BridgeBindings {
  return {
    db: dbFixture().adapter,
    file: { ...fileFixture(), read: async () => new Uint8Array() },
    proc: {
      spawn: async () => {
        throw new Error("unused");
      },
    },
  };
}
function capabilities() {
  const stream = { async *[Symbol.asyncIterator]() {}, close: vi.fn() };
  const auth: Auth = {
    getLoginState: vi.fn(async () => ({ status: "signed-out" as const })),
    startLogin: vi.fn(),
    pollLogin: vi.fn(),
    cancelLogin: vi.fn(),
    logout: vi.fn(),
  };
  const runtime: Runtime = {
    getCapabilities: vi.fn(),
    submitRun: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn(),
    recoverRun: vi.fn(),
    getSnapshot: vi.fn(),
    streamEvents: vi.fn(() => stream),
  };
  const render: Render = { getCapabilities: vi.fn(), render: vi.fn() };
  return { auth, runtime, render, stream };
}
describe("cloud bridge capability registration", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it("rejects missing capabilities and incomplete registrations atomically", async () => {
    const bridge = await import("../src/index.js"),
      c = capabilities();
    const incomplete = {
      ...base(),
      auth: { getLoginState: c.auth.getLoginState },
    };
    expect(() =>
      bridge.register(incomplete as unknown as BridgeBindings, {
        required: ["auth"],
      }),
    ).toThrow("auth.startLogin");
    await expect(
      bridge.auth.getLoginState({ clientRef: "client" }),
    ).rejects.toThrow("not registered");
    bridge.register(base(), { required: [] });
    await expect(
      bridge.runtime.getRun(
        { principalId: "p", workspaceId: "w", credentialRef: "s" },
        { projectId: "p", sessionId: "s", runId: "r" },
      ),
    ).rejects.toThrow("runtime is not registered");
    await expect(bridge.render.getCapabilities()).rejects.toThrow(
      "render is not registered",
    );
  });
  it("forwards every approved method and preserves the event stream lifecycle", async () => {
    const bridge = await import("../src/index.js"),
      c = capabilities();
    bridge.register(
      { ...base(), auth: c.auth, runtime: c.runtime, render: c.render },
      { required: ["auth", "runtime", "render"] },
    );
    const ctx = { clientRef: "client" },
      scope = { principalId: "p", workspaceId: "w", credentialRef: "secret" };
    const ref = { projectId: "p", sessionId: "s", runId: "r" },
      request = { session: ref, idempotencyKey: "k", input: "hello" };
    await bridge.auth.getLoginState(ctx);
    await bridge.auth.startLogin(ctx, { requestId: "request" });
    await bridge.auth.pollLogin(ctx, "attempt");
    await bridge.auth.cancelLogin(ctx, "attempt");
    await bridge.auth.logout(ctx);
    await bridge.runtime.getCapabilities();
    await bridge.runtime.submitRun(scope, request);
    await bridge.runtime.getRun(scope, ref);
    await bridge.runtime.cancelRun(scope, ref);
    await bridge.runtime.recoverRun(scope, ref);
    await bridge.runtime.getSnapshot(scope, ref);
    const events = bridge.runtime.streamEvents(scope, ref, "10");
    expect(events).toBe(c.stream);
    events.close();
    expect(c.stream.close).toHaveBeenCalledTimes(1);
    await bridge.render.getCapabilities();
    await bridge.render.render({ html: "html", format: "pdf" });
    expect(c.runtime.submitRun).toHaveBeenCalledWith(scope, request);
    expect(c.runtime.streamEvents).toHaveBeenCalledWith(scope, ref, "10");
    expect(c.auth.pollLogin).toHaveBeenCalledWith(ctx, "attempt");
    for (const capability of [c.auth, c.runtime, c.render]) {
      for (const method of Object.values(capability))
        expect(method).toHaveBeenCalledTimes(1);
    }
    expect(bridge.runtime).not.toHaveProperty("createSession");
    expect(bridge.auth).not.toHaveProperty("getRuntimeAuthorization");
  });
});
