import { createHash } from "node:crypto";
import { z } from "zod";
export interface FilesysPack {
  record: {
    type: string;
    id: string;
    runtime: { scope: string; owner: string; binding: string };
  };
  entries: {
    path: string;
    type: "file";
    executable: boolean;
    blobDigest: string;
    symlinkTarget: null;
  }[];
  metadata: unknown;
  blobs: Map<string, Buffer>;
  key: string;
}
const sha = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
// Filesys v1 content identity: sorted object keys, UTF-8 path ordering,
// normalized entries and metadata. Confirmed against the real service in tests.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        JSON.stringify(k) +
        ":" +
        canonical((value as Record<string, unknown>)[k]),
    )
    .join(",")}}`;
}
export function versionDigest(
  entries: Array<{ path: string }>,
  metadata: unknown,
) {
  return sha(
    "filesys.version.v1\0" +
      canonical({
        entries: [...entries].sort((a, b) =>
          Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
        ),
        metadata,
      }),
  );
}
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const revision = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const snapshot = z.object({
  resource: z.string(),
  pointer: z.string(),
  revision,
  version: digest,
  entries: z
    .array(
      z.object({
        path: z.string(),
        type: z.enum(["file", "dir", "symlink"]),
        executable: z.boolean(),
        blobDigest: digest.nullable(),
        symlinkTarget: z.string().nullable(),
      }),
    )
    .max(4096),
  metadata: z.record(z.unknown()),
  binding: z.string().optional(),
  generation: revision.optional(),
});
type Snapshot = z.infer<typeof snapshot>;
type Pack = FilesysPack;
export type PublishConfig = {
  url: string;
  token: string;
  concurrency?: number;
  fetcher?: typeof fetch;
};

// Each phase finishes before the next. On failure stop taking new work, wait
// for in-flight requests to settle, then reject (no hidden background writes).
async function parallel<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0,
    failed = false;
  let error: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = await run(items[i]!);
        } catch (e) {
          if (!failed) {
            failed = true;
            error = e;
          }
          return;
        }
      }
    }),
  );
  if (failed) throw error;
  return results;
}
export async function publishOfficialPackages(
  packs: Pack[],
  config: PublishConfig,
) {
  const started = performance.now();
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
  const concurrency = config.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6)
    throw new Error("Concurrency must be an integer between 1 and 6");
  const prepared = performance.now();
  const stats = {
    packages: packs.length,
    unchanged: 0,
    published: 0,
    rebound: 0,
    uploadedBlobs: 0,
    uploadedBytes: 0,
    reusedBlobs: 0,
    requests: 0,
    writeRequests: 0,
    concurrency,
    prepareMs: prepared - started,
    compareMs: 0,
    transferMs: 0,
    totalMs: 0,
  };
  async function call(
    owner: string,
    path: string,
    method = "GET",
    body?: unknown,
    missing = false,
  ): Promise<unknown> {
    stats.requests++;
    if (method !== "GET") stats.writeRequests++;
    const response = await (config.fetcher ?? fetch)(
      `${url.origin}/v1/system/${encodeURIComponent(owner)}${path}`,
      {
        method,
        redirect: "error",
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(body === undefined
            ? {}
            : {
                "content-type": Buffer.isBuffer(body)
                  ? "application/octet-stream"
                  : "application/json",
              }),
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? new Uint8Array(body)
              : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (missing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Filesys ${method} ${path.split("/")[1]} failed (${response.status})`,
      );
    }
    return response.status === 204 ? null : response.json();
  }
  function checked(
    value: unknown,
    pack: Pack,
    binding = false,
  ): Snapshot | null {
    if (value === null) return null;
    const s = snapshot.parse(value);
    if (
      s.resource !== pack.record.runtime.binding ||
      s.pointer !== "current" ||
      versionDigest(s.entries, s.metadata) !== s.version ||
      (binding && (s.binding !== pack.record.runtime.binding || !s.generation))
    )
      throw new Error("Filesys snapshot identity or SHA mismatch");
    return s;
  }
  const plans = await parallel(packs, concurrency, async (pack) => {
    const { owner, binding } = pack.record.runtime;
    // A resolved binding already contains the current pointer's version,
    // revision, files and metadata: one GET covers the common unchanged path.
    const bound = checked(
      await call(owner, `/bindings/${binding}`, "GET", undefined, true),
      pack,
      true,
    );
    const pointer =
      bound ??
      checked(
        await call(
          owner,
          `/resources/${binding}/pointers/current`,
          "GET",
          undefined,
          true,
        ),
        pack,
      );
    return {
      pack,
      pointer,
      bound,
      version: versionDigest(pack.entries, pack.metadata),
    };
  });
  stats.compareMs = performance.now() - prepared;
  // Only confirmed remote manifests in this invocation establish reuse, scoped
  // by owner. No persistent local cache is treated as remote existence proof.
  const known = new Set<string>();
  for (const { pack, pointer, bound } of plans)
    for (const s of [pointer, bound])
      for (const entry of s?.entries ?? [])
        if (entry.blobDigest)
          known.add(`${pack.record.runtime.owner}:${entry.blobDigest}`);
  const wanted = new Map<
    string,
    { owner: string; digest: string; data: Buffer }
  >();
  for (const { pack, pointer, version } of plans)
    if (pointer?.version !== version)
      for (const [digest, data] of pack.blobs)
        wanted.set(`${pack.record.runtime.owner}:${digest}`, {
          owner: pack.record.runtime.owner,
          digest,
          data,
        });
  const uploads = [...wanted.entries()]
    .filter(([key]) => !known.has(key))
    .map(([, value]) => value);
  stats.reusedBlobs = [...wanted.keys()].filter((key) => known.has(key)).length;
  await parallel(uploads, concurrency, async ({ owner, digest, data }) => {
    const receipt = z
      .object({ digest: z.string(), bytes: z.number() })
      .parse(await call(owner, "/blobs", "POST", data));
    if (receipt.digest !== digest || receipt.bytes !== data.length)
      throw new Error("Blob receipt mismatch");
    stats.uploadedBlobs++;
    stats.uploadedBytes += data.length;
  });
  const receipts = await parallel(
    plans,
    concurrency,
    async ({ pack, pointer, bound, version }) => {
      const { owner, binding } = pack.record.runtime;
      if (pointer?.version === version && bound?.version === version) {
        stats.unchanged++;
      } else {
        if (pointer?.version !== version) {
          if (!pointer) await call(owner, `/resources/${binding}`, "POST", {});
          const receipt = z
            .object({
              resource: z.string(),
              pointer: z.string(),
              version: digest,
              revision,
            })
            .parse(
              await call(owner, "/publications", "POST", {
                resource: binding,
                key: sha(pack.key + ":" + (pointer?.revision ?? "0")).slice(7),
                pointer: "current",
                expected: pointer?.revision ?? "0",
                entries: pack.entries,
                metadata: pack.metadata,
              }),
            );
          if (
            receipt.version !== version ||
            receipt.resource !== binding ||
            receipt.pointer !== "current"
          )
            throw new Error("Publication receipt mismatch");
          stats.published++;
        } else stats.rebound++;
        const current = checked(
          await call(owner, `/resources/${binding}/pointers/current`),
          pack,
        );
        if (current?.version !== version)
          throw new Error(
            "Pointer changed during publication; retry explicitly",
          );
        // Bindings follow pointers. Existing correct bindings need no rewrite.
        if (!bound)
          await call(owner, `/bindings/${binding}`, "PUT", {
            resource: binding,
            pointer: "current",
            expected: "0",
          });
        const final = checked(
          await call(owner, `/bindings/${binding}`),
          pack,
          true,
        );
        if (final?.version !== version)
          throw new Error("Binding changed during publication");
      }
      const exact = snapshot
        .omit({ pointer: true, revision: true })
        .parse(
          await call(
            owner,
            `/resources/${binding}/versions/${encodeURIComponent(version)}`,
          ),
        );
      if (
        exact.resource !== binding ||
        exact.version !== version ||
        versionDigest(exact.entries, exact.metadata) !== version
      )
        throw new Error("Filesys immutable version mismatch");
      return {
        type: pack.record.type,
        id: pack.record.id,
        ...pack.record.runtime,
        version,
        files: pack.entries.length,
      };
    },
  );
  stats.totalMs = performance.now() - started;
  stats.transferMs = stats.totalMs - stats.prepareMs - stats.compareMs;
  return { receipts, stats };
}
