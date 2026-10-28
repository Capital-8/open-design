import { describe, expect, it, vi } from "vitest";
import { createAmrRuntimeClient, readAmrEvents } from "../src/amr/index.js";

const ref = { project: "p", session: "s", run: "r" };
const run = {
  id: "r",
  project: "p",
  session: "s",
  status: "provider-status",
  answer: "",
  detail: "",
  key: "k",
  created: "2026-10-27T00:00:00Z",
};

describe("AMR wire protocol", () => {
  it("uses one refresh after explicit 401 and returns provider fields without bridge normalization", async () => {
    let cancelled = false;
    const first = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 401 },
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(Response.json(run));
    const authorize = vi.fn(async (refresh: boolean) =>
      refresh ? "fresh-grant" : "initial-grant",
    );
    const client = createAmrRuntimeClient({
      runtimeUrl: "https://amr.example",
      fetch: fetcher,
    });
    expect(await client.getRun(authorize, ref)).toEqual(run);
    expect(authorize.mock.calls).toEqual([[false], [true]]);
    expect(cancelled).toBe(true);
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-grant",
    });
  });

  it("does not replay mutations after transport loss or a server error", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection lost"));
    const authorize = vi.fn(async () => "grant");
    const client = createAmrRuntimeClient({
      runtimeUrl: "https://amr.example",
      fetch: fetcher,
    });
    await expect(
      client.submitRun(authorize, ref, { key: "k", input: "prepared" }),
    ).rejects.toMatchObject({
      name: "DependencyError",
      code: "runtime_unavailable",
      uncertain: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("preserves opaque authorization callback failures without turning them into transport failures", async () => {
    const failure = new Error("credential unavailable"),
      fetcher = vi.fn<typeof fetch>();
    const client = createAmrRuntimeClient({
      runtimeUrl: "https://amr.example",
      fetch: fetcher,
    });
    await expect(
      client.getRun(async () => {
        throw failure;
      }, ref),
    ).rejects.toBe(failure);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a frame whose SSE id does not match its payload sequence", async () => {
    const event = {
      run: "r",
      sequence: 2,
      time: run.created,
      signal: { kind: "provider-kind", opaque: 1 },
    };
    const response = new Response(
      "id: 1\ndata: " + JSON.stringify(event) + "\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expect(readAmrEvents(response).next()).rejects.toMatchObject({
      code: "runtime_protocol_error",
    });
    expect(response.body?.locked).toBe(false);
  });
});
