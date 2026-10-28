import { z } from "zod";
import { createHash } from "node:crypto";

import { canonical, versionDigest, type PublishConfig } from "./assets.js";

export const officialMetaFile = "official-resource-meta.json";
const owner = "open-design-official",
  resource = "official-resource-meta";

/** Publish only the catalogue file. Never uploads its referenced static packs. */
export async function publishOfficialMeta(data: Buffer, config: PublishConfig) {
  const url = new URL(config.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Filesys origin must be HTTPS or loopback HTTP");
  if (config.token.length < 32)
    throw new Error("Explicit Filesys operator token required");
  if (!data.length || data.length > 8 * 1024 * 1024)
    throw new Error("Official metadata exceeds Filesys blob budget");
  const sha256 = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  const entries = [
    {
      path: officialMetaFile,
      type: "file",
      executable: false,
      blobDigest: sha256,
      symlinkTarget: null,
    },
  ];
  const metadata = {
    kind: "official-resource-meta",
    schemaVersion: 1,
    sha256,
    bytes: data.length,
  };
  const version = versionDigest(entries, metadata);
  const release = {
    schemaVersion: 1,
    scope: "system",
    owner,
    resource,
    version,
    sha256,
    bytes: data.length,
    file: officialMetaFile,
  };
  const stats = { unchanged: false, uploadedBlobs: 0, writeRequests: 0 };
  const base = `${url.origin}/v1/system/${owner}`;
  async function call(path: string, method = "GET", body?: unknown) {
    if (method !== "GET") stats.writeRequests++;
    const response = await (config.fetcher ?? fetch)(base + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": Buffer.isBuffer(body)
          ? "application/octet-stream"
          : "application/json",
      },
      body:
        body === undefined
          ? undefined
          : Buffer.isBuffer(body)
            ? new Uint8Array(body)
            : JSON.stringify(body),
    });
    if (
      (method === "GET" && response.status === 404) ||
      response.status === 409
    ) {
      await response.body?.cancel();
      return { status: response.status, value: null };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Filesys metadata ${method} failed (${response.status})`);
    }
    return {
      status: response.status,
      value: response.status === 204 ? null : await response.json(),
    };
  }
  const path = `/resources/${resource}/versions/${encodeURIComponent(version)}`;
  const verify = (value: any) => {
    if (
      value?.resource !== resource ||
      value?.version !== version ||
      canonical(value?.entries) !== canonical(entries) ||
      canonical(value?.metadata) !== canonical(metadata)
    )
      throw new Error("Filesys metadata version mismatch");
  };
  function pointer(value: any, bound = false) {
    if (
      !value ||
      value.resource !== resource ||
      value.pointer !== "current" ||
      !/^[1-9][0-9]{0,17}$/.test(value.revision) ||
      !Array.isArray(value.entries) ||
      !value.metadata ||
      versionDigest(value.entries, value.metadata) !== value.version ||
      (bound &&
        (value.binding !== resource ||
          !/^[1-9][0-9]{0,17}$/.test(value.generation)))
    )
      throw new Error("Filesys metadata current pointer mismatch");
    return value;
  }
  const bound = await call(`/bindings/${resource}`);
  if (bound.status !== 200 && bound.status !== 404)
    throw new Error("Metadata binding lookup failed");
  const current =
    bound.status === 200
      ? pointer(bound.value, true)
      : await (async () => {
          const result = await call(`/resources/${resource}/pointers/current`);
          if (result.status === 404) return null;
          if (result.status !== 200)
            throw new Error("Metadata pointer lookup failed");
          return pointer(result.value);
        })();
  const existing = await call(path);
  if (existing.status === 200) verify(existing.value);
  else if (existing.status !== 404)
    throw new Error("Unexpected metadata lookup result");
  if (existing.status === 404) {
    const blob = await call("/blobs", "POST", data);
    if (
      !z
        .object({ digest: z.literal(sha256), bytes: z.literal(data.length) })
        .safeParse(blob.value).success
    )
      throw new Error("Metadata blob receipt mismatch");
    stats.uploadedBlobs++;
    const created = await call(`/resources/${resource}`, "POST", {});
    if (created.status !== 204)
      throw new Error("Metadata resource creation failed");
  }
  if (current?.version !== version) {
    const expected = current?.revision ?? "0";
    const publication = await call("/publications", "POST", {
      resource,
      key: createHash("sha256")
        .update(version + ":current:" + expected)
        .digest("hex"),
      pointer: "current",
      expected,
      entries,
      metadata,
    });
    if (publication.status === 409)
      throw new Error(
        "Metadata current changed concurrently; retry explicitly",
      );
    verify((await call(path)).value);
  }
  if (bound.status === 404) {
    const binding = await call(`/bindings/${resource}`, "PUT", {
      resource,
      pointer: "current",
      expected: "0",
    });
    if (binding.status === 409)
      throw new Error(
        "Metadata binding changed concurrently; retry explicitly",
      );
  }
  const final = pointer((await call(`/bindings/${resource}`)).value, true);
  verify(final);
  stats.unchanged = stats.writeRequests === 0;
  return { release, stats };
}
