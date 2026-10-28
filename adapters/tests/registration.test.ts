import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRenderAdapter } from "../src/render/index.js";

describe("render adapter with process-scoped bridge registration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the real HTTP adapter through render-only registration without touching unrelated capabilities", async () => {
    const bridge = await import("@open-design/bridge");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ exportFormats: ["pdf"], editablePptx: false }),
      )
      .mockResolvedValueOnce(
        new Response("%PDF-1.7", {
          headers: { "Content-Type": "application/pdf" },
        }),
      );
    bridge.register(
      {
        render: createHttpRenderAdapter({
          url: "https://renderer.example",
          fetch: fetcher,
        }),
      },
      { required: ["render"] },
    );
    expect(fetcher).not.toHaveBeenCalled(); // Structural registration performs no health request.
    expect(await bridge.render.getCapabilities()).toMatchObject({
      available: true,
      formats: ["pdf"],
    });
    expect(
      await bridge.render.render({
        html: "<html>content</html>",
        format: "pdf",
      }),
    ).toMatchObject({
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7"),
    });
    expect(() => bridge.db.read()).toThrow("capability db is not registered");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
