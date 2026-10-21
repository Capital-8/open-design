import path from "node:path";
import { tmpdir } from "node:os";
import { API } from "@typescript/native/unstable/sync";
import type { SourceFile } from "@typescript/native/unstable/ast";

class SourceParser {
  private readonly root = path.join(tmpdir(), "od-native-parser");
  private config = "";
  private sequence = 0;
  private last: { extension: string; source: string; tree: SourceFile } | undefined;
  private file = "";
  private source = "";
  private readonly api = new API({ fs: {
    readFile: (name) => {
      const resolved = path.resolve(name);
      if (resolved === this.file) return this.source;
      if (resolved === this.config) return JSON.stringify({
        compilerOptions: { noLib: true, noResolve: true, allowJs: true, types: [] },
        files: [this.file],
      });
      return undefined;
    },
    fileExists: (name) => path.resolve(name) === this.file || path.resolve(name) === this.config ? true : undefined,
  } });

  parse(fileName: string, source: string): SourceFile {
    const extension = path.extname(fileName) || ".ts";
    if (this.last?.extension === extension && this.last.source === source) return this.last.tree;
    const previousConfig = this.config;
    const id = ++this.sequence;
    // Each virtual project is immutable. Reusing a virtual file name can reuse
    // stale native snapshots even when a change notification is supplied.
    this.file = path.join(this.root, `source-${id}${extension}`);
    this.config = path.join(this.root, `tsconfig-${id}.json`);
    this.source = source;
    using snapshot = this.api.updateSnapshot({
      openProjects: [this.config],
      closeProjects: previousConfig ? [previousConfig] : [],
    });
    const parsed = snapshot.getProject(this.config)?.program.getSourceFile(this.file);
    if (!parsed) throw new Error(`Native TypeScript could not parse ${fileName}`);
    this.last = { extension, source, tree: parsed };
    return parsed;
  }

  close(): void {
    this.api.close();
  }
}

let activeParser: SourceParser | undefined;

/** Keep one native process for a guard run; always release it, including failures. */
export async function withNativeSourceParser<T>(run: () => Promise<T>): Promise<T> {
  const previous = activeParser;
  const parser = new SourceParser();
  activeParser = parser;
  try {
    return await run();
  } finally {
    activeParser = previous;
    parser.close();
  }
}

/** Parse only: no dependency resolution, libraries, or files written to disk. */
export function parseSource(fileName: string, source: string): SourceFile {
  if (activeParser) return activeParser.parse(fileName, source);
  const parser = new SourceParser();
  try {
    return parser.parse(fileName, source);
  } finally {
    parser.close();
  }
}
