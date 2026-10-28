import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createCloudFileAdapter } from "../src/file/index.js";
it("verifies bundled bytes and blocks traversal, symlink escape and changed content", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloud-file-"));
  try {
    await writeFile(join(root, "data"), "safe");
    await symlink("/etc/hosts", join(root, "escape"));
    const adapter = createCloudFileAdapter({
      amrUrl: "https://amr.test",
      resourceRoot: root,
      authorize: async () => "",
    });
    const sha256 = createHash("sha256").update("safe").digest("hex");
    expect(
      Buffer.from(
        await adapter.read({ kind: "bundled", path: "data", sha256 }),
      ).toString(),
    ).toBe("safe");
    await expect(
      adapter.read({ kind: "bundled", path: "../data", sha256 }),
    ).rejects.toMatchObject({ code: "invalid_file_reference" });
    await expect(
      adapter.read({ kind: "bundled", path: "escape", sha256 }),
    ).rejects.toMatchObject({ code: "invalid_file_reference" });
    await writeFile(join(root, "data"), "changed");
    await expect(
      adapter.read({ kind: "bundled", path: "data", sha256 }),
    ).rejects.toMatchObject({ code: "bundled_resource_changed" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves conditional write payload, credential scope and uncertain outcomes", async () => {
  const authorize = vi.fn(async (_scope: import("@open-design/bridge").RuntimeScope, _refresh: boolean) => "secret"),
    fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ path: "index.html", html: "new", version: "v2" }),
    );
  const adapter = createCloudFileAdapter({
    amrUrl: "https://amr.test",
    resourceRoot: "/unused",
    authorize,
    fetch: fetcher,
  });
  const scope = { principalId: "u", workspaceId: "w", credentialRef: "c" },
    ref = {
      kind: "project" as const,
      scope,
      projectId: "p",
      path: "index.html",
    };
  expect(
    await adapter.saveContent(ref, { html: "new", expected: "v1" }),
  ).toMatchObject({ version: "v2" });
  expect(authorize).toHaveBeenCalledWith(scope, false);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify({ html: "new", expected: "v1" }),
  });
  fetcher.mockRejectedValueOnce(Error("lost response"));
  await expect(
    adapter.saveContent(ref, { html: "new", expected: "v1" }),
  ).rejects.toMatchObject({ code: "runtime_unavailable", uncertain: true });
});
