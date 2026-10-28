import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createAmrProjectClient } from "../src/amr/index.js";
import { createAmrWorkspaceClient } from "../src/amr/index.js";
import { createGithubClient } from "../src/github/index.js";
import {
  publishOfficialPackages,
  publishOfficialMeta,
  versionDigest,
  type FilesysPack,
} from "../src/filesys/index.js";
it("preserves creation uncertainty and session identity, with one explicit 401 refresh", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ id: "p" }));
  const authorize = vi.fn(async (_refresh: boolean) => "grant");
  const client = createAmrProjectClient({
    runtimeUrl: "https://amr.test",
    fetch: fetcher,
  });
  expect(await client.createProject(authorize, "Project")).toEqual({ id: "p" });
  expect(authorize.mock.calls.map((args) => args[0])).toEqual([
    false,
    true,
    false,
  ]);
  fetcher.mockResolvedValueOnce(Response.json({ project: "other", id: "s" }));
  await expect(client.createSession(authorize, "p")).rejects.toMatchObject({
    code: "runtime_protocol_error",
    uncertain: true,
  });
  fetcher
    .mockResolvedValueOnce(Response.json({}))
    .mockRejectedValueOnce(Error("lost"));
  await expect(
    client.createProject(authorize, "Project"),
  ).rejects.toMatchObject({ uncertain: true });
});
it("normalizes only external workspace protocols, strips invitation secrets and keeps outages explicit", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: "invite", workspaceId: "w", token: "must-not-leak" }),
  );
  const client = createAmrWorkspaceClient({
    apiUrl: "https://vela.test",
    authorize: async () => "secret",
    fetch: fetcher,
  });
  expect(await client.invite({}, "w", "u@test.com", "member")).toEqual({
    id: "invite",
    workspaceId: "w",
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://vela.test/api/v1/workspaces/w/invites",
  );
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await expect(client.directory({})).rejects.toMatchObject({ status: 503 });
});
it("GitHub metadata uses a fixed anonymous endpoint and validates identity", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ full_name: "other/repo", stargazers_count: 1 }),
  );
  await expect(createGithubClient(fetcher).stats()).rejects.toMatchObject({
    code: "github_unavailable",
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://api.github.com/repos/nexu-io/open-design",
  );
  expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
    "Authorization",
  );
});
const bytes = Buffer.from("fixture"),
  digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
const pack: FilesysPack = {
  record: {
    type: "skill",
    id: "fixture",
    runtime: {
      scope: "system",
      owner: "open-design-official",
      binding: "fixture",
    },
  },
  entries: [
    {
      path: "SKILL.md",
      type: "file",
      executable: false,
      blobDigest: digest,
      symlinkTarget: null,
    },
  ],
  metadata: { schemaVersion: 1 },
  blobs: new Map([[digest, bytes]]),
  key: "fixture",
};
it("Filesys publishes conditionally, verifies exact versions, and retries with no repeated writes", async () => {
  let current: Record<string, unknown> | undefined,
    bound = false,
    writes = 0;
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      if (method === "GET") {
        if (path.includes("/bindings/") && !bound)
          return new Response(null, { status: 404 });
        return current
          ? Response.json({
              ...current,
              ...(path.includes("/bindings/")
                ? { binding: "fixture", generation: "1" }
                : {}),
            })
          : new Response(null, { status: 404 });
      }
      writes++;
      if (path.endsWith("/blobs"))
        return Response.json({ digest, bytes: bytes.length });
      if (path.endsWith("/publications")) {
        const input = JSON.parse(String(init?.body));
        expect(input.expected).toBe("0");
        current = {
          ...input,
          revision: "1",
          version: versionDigest(input.entries, input.metadata),
        };
        return Response.json(current);
      }
      if (path.includes("/bindings/")) bound = true;
      return new Response(null, { status: 204 });
    },
  );
  const config = {
    url: "https://filesys.test",
    token: "test-token-".repeat(5),
    fetcher,
  };
  expect((await publishOfficialPackages([pack], config)).stats.published).toBe(
    1,
  );
  const count = writes;
  expect((await publishOfficialPackages([pack], config)).stats.unchanged).toBe(
    1,
  );
  expect(writes).toBe(count);
  for (const status of [401, 403, 503]) {
    const failing = vi.fn(async () => new Response(null, { status }));
    await expect(
      publishOfficialPackages([pack], { ...config, fetcher: failing }),
    ).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);
  }
});
it("Filesys metadata stops on concurrent publication conflict without overwriting pointers", async () => {
  const data = Buffer.from("{}"),
    writes: string[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "GET") return new Response(null, { status: 404 });
    writes.push(path);
    if (path.endsWith("/blobs"))
      return Response.json({
        digest: "sha256:" + createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
      });
    if (path.endsWith("/publications"))
      return new Response(null, { status: 409 });
    return new Response(null, { status: 204 });
  };
  await expect(
    publishOfficialMeta(data, {
      url: "https://filesys.test",
      token: "test-token-".repeat(5),
      fetcher,
    }),
  ).rejects.toThrow("current changed concurrently");
  expect(writes.some((v) => v.includes("/bindings/"))).toBe(false);
});
