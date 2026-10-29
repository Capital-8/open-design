import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFile, mkdir, chmod, rename, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { load, JSON_SCHEMA } from "js-yaml";
import {
  bundledManifest,
  bakedPreviewManifest,
  type BundledPlugin,
  type BundledSkill,
} from "@open-design/contracts/cloud/legacy-catalog";
import {
  bundledDesignSystemManifest,
  type BundledDesignSystem,
} from "@open-design/contracts/cloud/legacy-design-systems";

type Entry = { path: string; bytes: number; sha256: string };
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const text = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const digest = (v: Buffer) => createHash("sha256").update(v).digest("hex");

// Build-time snapshot only. Runtime never scans a user's daemon DB, installs a
// package, or executes SKILL.md/scripts. Future cloud ownership: POC-022.
export async function buildBundledCatalog(
  resources: string,
  destination: string,
) {
  const indexBytes = await readFile(join(resources, "manifest.json"));
  const index = JSON.parse(indexBytes.toString()) as { files: Entry[] };
  const entries = new Map(index.files.map((e) => [e.path, e]));
  async function read(path: string) {
    const entry = entries.get(path);
    if (
      !entry ||
      path.split("/").some((p) => !p || p === "." || p === "..") ||
      path.includes("\\")
    )
      throw new Error("Invalid bundled resource path");
    const bytes = await readFile(join(resources, path));
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
      throw new Error("Bundled resource integrity mismatch: " + path);
    return bytes;
  }
  const previewIndex = "data/plugin-previews/manifest.json";
  const baked = entries.has(previewIndex)
    ? bakedPreviewManifest.parse(
        JSON.parse((await read(previewIndex)).toString()),
      ).previews
    : {};
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + ".building";
  await rm(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec(`
      PRAGMA user_version=2;
      CREATE TABLE catalog_meta (manifest_sha256 TEXT NOT NULL);
      CREATE TABLE installed_plugins (id TEXT PRIMARY KEY, record_json TEXT NOT NULL, root TEXT NOT NULL);
      CREATE TABLE skills (id TEXT PRIMARY KEY, summary_json TEXT NOT NULL, body TEXT NOT NULL, root TEXT NOT NULL);
      CREATE TABLE design_systems (id TEXT PRIMARY KEY, summary_json TEXT NOT NULL, manifest_json TEXT NOT NULL);
      CREATE TABLE assets (kind TEXT NOT NULL, owner_id TEXT NOT NULL, path TEXT NOT NULL, resource_path TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(kind,owner_id,path));
      BEGIN;
    `);
    db.prepare("INSERT INTO catalog_meta VALUES (?)").run(digest(indexBytes));
    function assets(kind: string, id: string, root: string) {
      const insert = db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?)");
      for (const entry of index.files)
        if (entry.path.startsWith(root + "/")) {
          const path = entry.path.slice(root.length + 1);
          if (
            path.split("/").some((p) => !p || p === "." || p === "..") ||
            path.includes("\\")
          )
            throw new Error("Invalid asset path");
          insert.run(kind, id, path, entry.path, entry.sha256, entry.bytes);
        }
    }
    for (const path of [...entries.keys()].sort()) {
      if (/^plugins\/_official\/(?:[^/]+\/)?[^/]+\/open-design\.json$/.test(path)) {
        const bytes = await read(path),
          manifest = bundledManifest.parse(JSON.parse(bytes.toString()));
        const root = posix.dirname(path),
          timestamp = Date.parse(manifest.publishedAt ?? "") || 0;
        const record: BundledPlugin = {
          id: manifest.name,
          title: manifest.title,
          version: manifest.version,
          sourceKind: "bundled",
          source: "bundled:" + manifest.name,
          sourceDigest: entries.get(path)!.sha256,
          trust: "bundled",
          // Bundled provenance is not permission to execute a cloud capability.
          capabilitiesGranted: [],
          manifest,
          fsPath: "",
          installedAt: timestamp,
          updatedAt: timestamp,
        };
        // Match the original daemon's response projection. Keep od.preview for
        // interactive details; only gallery cards opt into these CDN previews.
        // The manifest is pinned with the bundle, not fetched during requests.
        const preview = baked[record.id];
        if (preview) {
          const base = "https://repo-assets.open-design.ai/plugin-previews";
          record.manifest = {
            ...manifest,
            od: {
              ...manifest.od,
              bakedPreview: {
                poster: `${base}/${preview.poster}`,
                video: `${base}/${preview.video}`,
                ...(preview.holdMs !== undefined
                  ? { holdMs: preview.holdMs }
                  : {}),
              },
            },
          };
        }
        db.prepare("INSERT INTO installed_plugins VALUES (?,?,?)").run(
          record.id,
          JSON.stringify(record),
          root,
        );
        assets("plugin", record.id, root);
      } else if (/^design-systems\/[^/]+\/DESIGN\.md$/.test(path)) {
        const root = posix.dirname(path);
        const id = posix.basename(root);
        const manifest = bundledDesignSystemManifest.parse(
          JSON.parse((await read(`${root}/manifest.json`)).toString()),
        );
        if (manifest.id !== id)
          throw new Error("Bundled design system identity mismatch");
        const markdown = (await read(path)).toString("utf8");
        const summary: BundledDesignSystem = {
          id,
          title: manifest.name,
          category: manifest.category,
          summary:
            manifest.description ??
            markdown
              .split("\n")
              .find(
                (line) =>
                  line.startsWith("> ") && !line.startsWith("> Category:"),
              )
              ?.slice(2) ??
            "",
          swatches: [
            ...new Set(markdown.match(/#[0-9a-f]{6}\b/gi) ?? []),
          ].slice(0, 6),
          source: "built-in",
          status: "published",
          isEditable: false,
          canMutate: false,
        };
        db.prepare("INSERT INTO design_systems VALUES (?,?,?)").run(
          id,
          JSON.stringify(summary),
          JSON.stringify(manifest),
        );
        assets("design-system", id, root);
      } else if (/^(skills|design-templates)\/[^/]+\/SKILL\.md$/.test(path)) {
        const markdown = (await read(path)).toString();
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
        const data = object(
          match ? load(match[1]!, { schema: JSON_SCHEMA }) : {},
        );
        const body = match ? markdown.slice(match[0].length) : markdown;
        const od = object(data.od),
          root = posix.dirname(path);
        const id = text(data.name, posix.basename(root));
        if (!id || id.length > 256 || /[\/\\\u0000-\u001f]/.test(id))
          throw new Error("Invalid bundled skill id");
        const mode = text(od.mode, "prototype");
        const summary: BundledSkill = {
          id,
          name: id,
          description: text(data.description),
          triggers: strings(data.triggers),
          mode,
          surface: text(
            od.surface,
            ["image", "video", "audio"].includes(mode) ? mode : "web",
          ),
          source: "built-in",
          previewType: text(object(od.preview).type, "html"),
          designSystemRequired: object(od.design_system).requires !== false,
          defaultFor: strings(od.default_for),
          upstream: typeof od.upstream === "string" ? od.upstream : null,
          hasBody: body.trim().length > 0,
          examplePrompt: text(od.example_prompt),
          aggregatesExamples: false,
          platform: od.platform ?? null,
          scenario: od.scenario ?? null,
          category: od.category ?? null,
          craftRequires: strings(object(od.craft).requires),
          ...(data.zh_name || data.en_name
            ? {
                displayName: {
                  ...(data.zh_name ? { "zh-CN": text(data.zh_name) } : {}),
                  ...(data.en_name ? { en: text(data.en_name) } : {}),
                },
              }
            : {}),
          ...(od.example_prompt_i18n
            ? { examplePromptI18n: object(od.example_prompt_i18n) }
            : {}),
        };
        db.prepare("INSERT INTO skills VALUES (?,?,?,?)").run(
          id,
          JSON.stringify(summary),
          body,
          root,
        );
        assets("skill", id, root);
      }
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  await chmod(temporary, 0o444);
  await rename(temporary, destination);
}
