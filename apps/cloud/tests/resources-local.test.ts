import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { OfficialCatalog } from "@open-design/biz/catalog/official";
import { prepareRuntimeBundle } from "../scripts/resources/runtime-bundle.js";
import { loadBundle } from "../scripts/resources/bundle.js";
import { officialPackage, packageSource } from "../scripts/resources/package.js";

it("keeps incomplete resources visible and unusable locally, while release validation still rejects them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "od-local-resource-"));
  const source = join(directory, "source"), root = join(directory, "bundle");
  const files = {
    "LICENSE": "Fixture license",
    "craft/layout.md": "Layout rules",
    "design-systems/sample/DESIGN.md": "Design rules",
    "design-systems/sample/manifest.json": JSON.stringify({ schemaVersion: "1", id: "sample", name: "Sample" }),
    "design-templates/deck/SKILL.md": "---\nname: deck\ndescription: Deck\n---\nDeck rules",
    "skills/draw/SKILL.md": "---\nname: draw\ndescription: Draw\n---\nDraw rules",
    "plugins/_official/good/open-design.json": JSON.stringify({ name: "good", title: "Good", version: "1", od: { context: { craft: ["layout"] } } }),
    "plugins/_official/incomplete/open-design.json": JSON.stringify({ name: "incomplete", title: "Incomplete", version: "1", od: { context: { craft: ["missing"] } } }),
    "data/plugin-previews/manifest.json": '{"previews":{}}',
  };
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(source, path)), { recursive: true });
      await writeFile(join(source, path), text);
    }
    const git = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init"); git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "Fixture");
    const revision = git("rev-parse", "HEAD").trim();
    const result = await prepareRuntimeBundle({ source, root, revision });
    expect(result.resources).toBe(5);
    expect(result.incomplete).toEqual([{ type: "plugin", id: "incomplete", issues: ["Missing craft: missing"] }]);
    expect(JSON.parse(await readFile(join(root, "resource-validation.json"), "utf8"))).toEqual({ revision, incomplete: result.incomplete });
    const db = new DatabaseSync(join(root, "catalog.sqlite"), { readOnly: true });
    try { expect(db.prepare("SELECT count(*) AS n FROM installed_plugins").get()?.n).toBe(2); }
    finally { db.close(); }
    const meta = JSON.parse(await readFile(join(root, "official-resource-meta.json"), "utf8"));
    const catalog = Object.assign(new OfficialCatalog(meta, path => readFile(join(root, "resources", path))), { root: join(root, "resources") });
    const pack = await officialPackage(catalog, { type: "plugin", id: "good" }, await packageSource(catalog));
    expect(pack.entries.map(entry => entry.path)).toContain("craft/layout.md");
    expect(() => catalog.closure([{ type: "plugin", id: "incomplete" }])).toThrow("Missing craft: missing");
    vi.stubEnv("OD_CLOUD_RESOURCE_DIR", root);
    vi.stubEnv("OD_CLOUD_RESOURCE_REVISION", revision);
    await expect(loadBundle()).rejects.toThrow("Missing craft: missing");
    await expect(prepareRuntimeBundle({ source, root, revision })).rejects.toThrow("destination must be empty");
    await writeFile(join(root, "resources/craft/layout.md"), "tampered");
    await expect(loadBundle()).rejects.toThrow("integrity mismatch");
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
