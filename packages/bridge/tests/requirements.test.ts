import { fileFixture, reference } from "./file-fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeBindings, RegisterOptions, Render } from "../src/index.js";

function renderAdapter(): Render {
  return {
    async getCapabilities() {
      return { available: false, reason: "test-engine-offline" };
    },
    async render() {
      throw new Error("not used");
    },
  };
}

describe("consumer-declared capability requirements", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers render alone and explicitly rejects omitted base capabilities", async () => {
    const bridge = await import("../src/index.js");
    bridge.register({ render: renderAdapter() }, { required: ["render"] });
    expect(await bridge.render.getCapabilities()).toEqual({
      available: false,
      reason: "test-engine-offline",
    });
    expect(() => bridge.db.read()).toThrow("capability db is not registered");
    await expect(bridge.file.read(reference)).rejects.toThrow(
      "capability file is not registered",
    );
    await expect(
      bridge.proc.spawn({ command: "unused", args: [], cwd: "." }),
    ).rejects.toThrow("capability proc is not registered");
    await expect(bridge.auth.getLoginState({ clientRef: "c" })).rejects.toThrow(
      "capability auth is not registered",
    );
    await expect(bridge.runtime.getCapabilities()).rejects.toThrow(
      "capability runtime is not registered",
    );
  });

  it("does not derive required capabilities from the supplied bindings", async () => {
    const bridge = await import("../src/index.js");
    expect(() =>
      bridge.register(
        { render: renderAdapter() },
        { required: ["db", "render"] },
      ),
    ).toThrow("requires capability db");
    await expect(bridge.render.getCapabilities()).rejects.toThrow(
      "Bridge is not registered",
    );
    bridge.register({ render: renderAdapter() }, { required: ["render"] });
  });

  it.each([
    { render: undefined },
    { render: {} },
    { render: { getCapabilities: async () => ({ available: false }) } },
  ])(
    "rejects incomplete supplied capabilities even if not required: %o",
    async (bindings) => {
      const bridge = await import("../src/index.js");
      expect(() =>
        bridge.register(bindings as BridgeBindings, { required: [] }),
      ).toThrow("Bridge requires render.");
      bridge.register({}, { required: [] });
      await expect(bridge.render.getCapabilities()).rejects.toThrow(
        "capability render is not registered",
      );
    },
  );

  it.each([
    undefined,
    null,
    {},
    { required: "render" },
    { required: ["files"] },
    { required: [Symbol("render")] },
  ])(
    "rejects invalid requirement declarations atomically: %o",
    async (options) => {
      const bridge = await import("../src/index.js");
      expect(() => bridge.register({}, options as RegisterOptions)).toThrow();
      bridge.register({}, { required: [] });
    },
  );

  it("rejects unknown symbol capability keys without committing", async () => {
    const bridge = await import("../src/index.js");
    expect(() =>
      bridge.register(
        { [Symbol("render")]: renderAdapter() },
        { required: [] },
      ),
    ).toThrow("Only db");
    bridge.register({ render: renderAdapter() }, { required: ["render"] });
  });
});
