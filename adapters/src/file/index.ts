import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  BridgeError,
  type File,
  type ProjectFileRef,
  type RuntimeScope,
} from "@open-design/bridge";
import { createAmrFileClient } from "@open-design/dependencies/amr";
import { callDependency } from "../internal/errors.js";
export function createCloudFileAdapter(options: {
  amrUrl: string;
  authorize(scope: RuntimeScope, refresh: boolean): Promise<string>;
  resourceRoot: string;
  fetch?: typeof fetch;
}): File {
  const client = createAmrFileClient({
    runtimeUrl: options.amrUrl,
    fetch: options.fetch ?? fetch,
  });
  const valid = (path: string) =>
    !!path &&
    path.length <= 4096 &&
    !/[\\\x00-\x1f\x7f]/.test(path) &&
    !path.split("/").some((p) => !p || p === "." || p === "..");
  function check(ref: ProjectFileRef, entry = false) {
    if (
      !ref.projectId ||
      !valid(ref.path) ||
      (entry && ref.path !== "index.html")
    )
      throw new BridgeError("invalid_file_reference");
  }
  const authorize = (scope: RuntimeScope) => (refresh: boolean) =>
    options.authorize(scope, refresh);
  return {
    async read(ref) {
      if (ref.kind === "project") {
        check(ref);
        return callDependency(() =>
          client.raw(authorize(ref.scope), ref.projectId, ref.path),
        );
      }
      if (
        ref.kind !== "bundled" ||
        !valid(ref.path) ||
        !/^[a-f0-9]{64}$/.test(ref.sha256)
      )
        throw new BridgeError("invalid_file_reference");
      const root = await realpath(options.resourceRoot),
        path = await realpath(resolve(root, ref.path));
      if (!path.startsWith(root + sep))
        throw new BridgeError("invalid_file_reference");
      const data = await readFile(path);
      if (createHash("sha256").update(data).digest("hex") !== ref.sha256)
        throw new BridgeError("bundled_resource_changed");
      return data;
    },
    async readContent(ref) {
      check(ref, true);
      return callDependency(() =>
        client.readContent(authorize(ref.scope), ref.projectId),
      );
    },
    async directory(ref, cursor) {
      if (!ref.projectId || cursor.length > 4096)
        throw new BridgeError("invalid_file_reference");
      const value = await callDependency(() =>
        client.directory(authorize(ref.scope), ref.projectId, cursor),
      );
      return {
        ...value,
        files: value.files.map((f) => ({ ...f, size: String(f.size) })),
      };
    },
    async saveContent(ref, input) {
      check(ref, true);
      if (
        typeof input.expected !== "string" ||
        Buffer.byteLength(input.html) > 65536
      )
        throw new BridgeError("invalid_file_save");
      return callDependency(() =>
        client.saveContent(
          authorize(ref.scope),
          ref.projectId,
          input.html,
          input.expected,
        ),
      );
    },
  };
}
