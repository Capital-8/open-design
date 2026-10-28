import type { File, FileRef } from "../src/index.js";
export const reference: FileRef = {
  kind: "bundled",
  path: "test.txt",
  sha256: "0".repeat(64),
};
export function fileFixture(): File {
  return {
    read: async () => new Uint8Array(),
    readContent: async () => ({ path: "index.html", html: "", version: "v1" }),
    directory: async () => ({ cursor: "", files: [] }),
    saveContent: async (_ref, input) => ({
      path: "index.html",
      html: input.html,
      version: "v2",
    }),
  };
}
