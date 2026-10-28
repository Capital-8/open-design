import { requireCapability } from "./register.js";
import type { RuntimeScope } from "./runtime.js";
export interface ProjectFileRef {
  kind: "project";
  scope: RuntimeScope;
  projectId: string;
  path: string;
}
export interface BundledFileRef {
  kind: "bundled";
  path: string;
  sha256: string;
}
export type FileRef = ProjectFileRef | BundledFileRef;
export interface FileContent {
  path: "index.html";
  html: string;
  version: string;
  modified?: string;
}
export interface FileDirectory {
  cursor: string;
  files: { path: string; kind: string; size: string }[];
}
export interface File {
  read(reference: FileRef): Promise<Uint8Array>;
  readContent(reference: ProjectFileRef): Promise<FileContent>;
  directory(
    reference: Omit<ProjectFileRef, "path">,
    cursor: string,
  ): Promise<FileDirectory>;
  saveContent(
    reference: ProjectFileRef,
    input: { html: string; expected: string },
  ): Promise<FileContent>;
}
export const file: Readonly<File> = Object.freeze({
  read: async (reference) => requireCapability("file").read(reference),
  readContent: async (reference) =>
    requireCapability("file").readContent(reference),
  directory: async (reference, cursor) =>
    requireCapability("file").directory(reference, cursor),
  saveContent: async (reference, input) =>
    requireCapability("file").saveContent(reference, input),
} satisfies File);
