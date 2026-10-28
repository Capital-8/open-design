import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
  chmod,
  realpath,
} from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Vendored data only: do not import or execute resource scripts or SKILL.md.

const roots = [
  "design-systems",
  "design-templates",
  "plugins/_official",
  "skills",
  "craft",
  "data/plugin-previews/manifest.json",
  "LICENSE",
];
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type Entry = {
  path: string;
  bytes: number;
  sha256: string;
  executable: boolean;
};
type Manifest = {
  version: 1;
  source: { repository: string; commit: string; roots: string[] };
  files: Entry[];
};

async function paths(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...(await paths(root, path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported resource entry: ${path}`);
  }
  return result.sort();
}

export async function verifyResources(destination: string) {
  const manifest = JSON.parse(
    await readFile(join(destination, "manifest.json"), "utf8"),
  ) as Manifest;
  if (manifest.version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.source.commit))
    throw new Error("Invalid resource manifest");
  const expected = manifest.files.map((entry) => entry.path).sort();
  if (new Set(expected).size !== expected.length)
    throw new Error("Duplicate resource manifest paths");
  const actual = (await paths(destination)).filter(
    (path) => path !== "manifest.json",
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Resource inventory differs from manifest");
  for (const entry of manifest.files) {
    if (
      !roots.some(
        (root) => entry.path === root || entry.path.startsWith(root + "/"),
      )
    )
      throw new Error(`Unexpected resource root: ${entry.path}`);
    if (
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid resource path");
    const path = join(destination, entry.path);
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
      throw new Error(`Resource integrity mismatch: ${entry.path}`);
    if (
      process.platform !== "win32" &&
      Boolean((await lstat(path)).mode & 0o111) !== entry.executable
    )
      throw new Error(`Resource mode mismatch: ${entry.path}`);
  }
  const counts = {
    designSystems: actual.filter((path) =>
      /^design-systems\/[^/]+\/DESIGN\.md$/.test(path),
    ).length,
    designTemplates: actual.filter((path) =>
      /^design-templates\/[^/]+\/SKILL\.md$/.test(path),
    ).length,
    officialPlugins: actual.filter((path) =>
      /^plugins\/_official\/.+\/open-design\.json$/.test(path),
    ).length,
    skills: actual.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path))
      .length,
    craftFiles: actual.filter((path) => path.startsWith("craft/")).length,
  };
  console.log(
    JSON.stringify(
      {
        sourceCommit: manifest.source.commit,
        files: actual.length,
        bytes: manifest.files.reduce((sum, entry) => sum + entry.bytes, 0),
        ...counts,
      },
      null,
      2,
    ),
  );
}

export async function importResources(
  source: string,
  destination: string,
  revision: string,
) {
  const sourceRoot = await realpath(source);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", sourceRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  if (await realpath(git("rev-parse", "--show-toplevel").trim()) !== sourceRoot)
    throw new Error("Source must be the original repository root");
  if (
    git("status", "--porcelain", "--untracked-files=no", "--", ...roots).trim()
  )
    throw new Error(
      "Source resources contain tracked edits; use a clean resource snapshot",
    );
  if (git("rev-parse", "HEAD").trim() !== revision)
    throw new Error("Resource revision differs from source HEAD");
  const files = git("ls-files", "-z", "--", ...roots)
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const root of roots)
    if (!files.some((path) => path === root || path.startsWith(root + "/")))
      throw new Error(`Missing resource root: ${root}`);
  // Refuse an overwrite. Updating the bundle is a deliberate replacement of a
  // reviewed snapshot, never a sync that deletes unrelated local files.
  await mkdir(destination, { recursive: false });
  const entries: Entry[] = [];
  for (const path of files) {
    const original = join(sourceRoot, path);
    const stat = await lstat(original);
    if (!stat.isFile())
      throw new Error(`Only regular tracked files may be vendored: ${path}`);
    if (
      /(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i.test(
        path,
      ) ||
      /\.(pem|key|p12)$/i.test(path)
    )
      throw new Error("Sensitive resource path: " + path);
    const content = await readFile(original);
    if (
      content
        .subarray(0, 80)
        .toString()
        .startsWith("version https://git-lfs.github.com/spec/v1")
    )
      throw new Error(`Materialize LFS resource first: ${path}`);
    const target = join(destination, path);
    if (relative(destination, target).startsWith(".."))
      throw new Error("Invalid source path");
    await mkdir(dirname(target), { recursive: true });
    await copyFile(original, target);
    await chmod(target, stat.mode & 0o777);
    entries.push({
      path,
      bytes: content.length,
      sha256: digest(content),
      executable: Boolean(stat.mode & 0o111),
    });
  }
  const manifest: Manifest = {
    version: 1,
    source: {
      repository: "https://github.com/nexu-io/open-design",
      commit: git("rev-parse", "HEAD").trim(),
      roots,
    },
    files: entries,
  };
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await verifyResources(destination);
}
