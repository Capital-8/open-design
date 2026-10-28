import { expect, it, vi } from "vitest";
import {
  createAmrAuthClient,
  createAmrAuthorizationClient,
  createAmrWorkspaceClient,
  createAmrBillingClient,
  createAmrProjectClient,
  createAmrRuntimeClient,
  createAmrFileClient,
  createAmrResourceClient,
} from "../src/amr/index.js";

it("keeps account keys on the API and execution grants on the Runtime through one provider entrypoint", async () => {
  const profile = {
    id: "actor",
    authUserId: "user",
    email: "u@test.com",
    name: null,
    status: "active",
  };
  const grant = {
    token: "od_grant_execution",
    actor: "actor",
    workspace: "w",
    expires: "2026-10-28T00:00:00Z",
  };
  const run = {
    id: "r",
    project: "p",
    session: "s",
    key: "k",
    status: "running",
    answer: "",
    detail: "",
    created: "2026-10-28T00:00:00Z",
  };
  const balance = {
    workspaceId: "w",
    workspaceMemberId: "m",
    billingScopeVersion: 2,
    balanceUsd: "12",
    expiresAt: null,
    updatedAt: null,
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      url.origin === "https://api.test"
        ? "Bearer account-key"
        : "Bearer od_grant_execution",
    );
    switch (url.pathname) {
      case "/api/v1/me":
        return Response.json(profile);
      case "/api/v1/harness/authorizations":
        return Response.json(grant);
      case "/api/v1/workspaces":
        return Response.json({ items: [] });
      case "/api/v1/workspaces/w/wallet/balance":
        return Response.json(balance);
      case "/v1/me":
        return Response.json({});
      case "/v1/projects":
        return Response.json({ id: "p" });
      case "/v1/projects/p/sessions":
        return Response.json({ id: "s", project: "p" });
      case "/v1/projects/p/sessions/s/runs/r":
        return Response.json(run);
      case "/v1/projects/p/files/index.html":
        return Response.json({
          path: "index.html",
          html: "<p>content</p>",
          version: "v1",
        });
      case "/v1/official-resources":
        return Response.json({ version: 1, maxSelections: 2, resources: [] });
      default:
        throw Error("Unexpected endpoint: " + url.pathname);
    }
  });
  const api = { apiUrl: "https://api.test", fetch: fetcher };
  const control = {
    ...api,
    authorize: async (_identity: { id: string }) => "account-key",
  };
  const runtimeOptions = { runtimeUrl: "https://runtime.test", fetch: fetcher };
  const auth = createAmrAuthClient({
    ...api,
    webUrl: "https://login.test/cloud",
  });
  const authorization = createAmrAuthorizationClient(api);
  const workspaces = createAmrWorkspaceClient(control);
  const billing = createAmrBillingClient(control);
  const projects = createAmrProjectClient(runtimeOptions);
  const runtime = createAmrRuntimeClient(runtimeOptions);
  const files = createAmrFileClient(runtimeOptions);
  const resources = createAmrResourceClient(runtimeOptions);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await auth.getProfile("account-key")).toEqual(profile);
  const result = await authorization.authorize("account-key", "w");
  const authorize = vi.fn(async (_refresh: boolean) => result.token);
  expect(await workspaces.directory({ id: "user" })).toEqual({ items: [] });
  expect(await billing.balance({ id: "user" }, "w")).toEqual(balance);
  expect(await projects.createProject(authorize, "Project")).toEqual({
    id: "p",
  });
  expect(await projects.createSession(authorize, "p")).toEqual({
    id: "s",
    project: "p",
  });
  expect(
    await runtime.getRun(authorize, { project: "p", session: "s", run: "r" }),
  ).toEqual(run);
  expect(await files.readContent(authorize, "p")).toMatchObject({
    version: "v1",
  });
  expect(await resources.officialResources(authorize)).toEqual({
    version: 1,
    maxSelections: 2,
    resources: [],
  });
  expect(fetcher).toHaveBeenCalledTimes(10);
});

it("preserves billing paths, account-key errors and the API's no-refresh behavior", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({}, { status: 401 }));
  const authorize = vi.fn(async () => "account-key");
  const client = createAmrBillingClient({
    apiUrl: "https://api.test",
    authorize,
    fetch: fetcher,
  });
  await expect(client.preflight({}, "w /", "model/a b")).rejects.toMatchObject({
    status: 401,
    uncertain: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://api.test/api/v1/workspaces/w%20%2F/billing/preflight?modelId=model%2Fa+b",
  );
  fetcher.mockResolvedValueOnce(Response.json({ balanceUsd: "bad" }));
  await expect(client.balance({}, "w")).rejects.toMatchObject({
    code: "vela_protocol_error",
    uncertain: false,
  });
});

it("preserves conditional file writes, binary reads and directory/resource DTO checks after splitting clients", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ path: "index.html", html: "new", version: "v2" }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 1])))
    .mockResolvedValueOnce(
      Response.json({
        cursor: "",
        files: [{ path: "index.html", kind: "file", size: 3 }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ version: 1, maxSelections: -1, resources: [] }),
    );
  const options = { runtimeUrl: "https://runtime.test", fetch: fetcher };
  const files = createAmrFileClient(options),
    resources = createAmrResourceClient(options);
  const authorize = async () => "grant";
  expect(await files.saveContent(authorize, "p /", "new", "v1")).toMatchObject({
    version: "v2",
  });
  expect(fetcher.mock.calls[0]).toEqual([
    "https://runtime.test/v1/projects/p%20%2F/files/index.html",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ html: "new", expected: "v1" }),
    }),
  ]);
  expect(await files.raw(authorize, "p", "image.png")).toEqual(
    new Uint8Array([0, 255, 1]),
  );
  expect(await files.directory(authorize, "p", "cursor +/")).toMatchObject({
    cursor: "",
    files: [{ path: "index.html", size: 3 }],
  });
  expect(fetcher.mock.calls[2]?.[0]).toBe(
    "https://runtime.test/v1/projects/p/directory?cursor=cursor+%2B%2F",
  );
  await expect(resources.officialResources(authorize)).rejects.toMatchObject({
    code: "runtime_protocol_error",
    uncertain: false,
  });
});
