import { db, file } from "@open-design/bridge";
import type {
  BundledPlugin,
  BundledSkill,
} from "@open-design/contracts/cloud/legacy-catalog";
import { bundledMarketplaceEntry } from "@open-design/contracts/cloud/legacy-catalog";
import type { BundledDesignSystem } from "@open-design/contracts/cloud/legacy-design-systems";
import { unavailable } from "../errors.js";
export type CatalogKind = "plugin" | "skill" | "design-system";

export class BundledCatalog {
  close() {
    /* Process composition owns adapter lifetimes. */
  }
  private async row(kind: CatalogKind, id: string) {
    const row = await db.read().catalog.get(kind, id);
    if (!row) throw unavailable();
    return row;
  }
  async plugins(): Promise<BundledPlugin[]> {
    return (await db
      .read()
      .catalog.list("plugin")) as unknown as BundledPlugin[];
  }
  async marketplace(id = "official") {
    if (id !== "official") throw unavailable();
    const version = await db.read().catalog.digest();
    return {
      id: "official",
      url: "/api/marketplaces/official",
      trust: "official" as const,
      specVersion: "1.0.0",
      version,
      manifest: {
        name: "OpenDesign Bundled Official Plugins",
        specVersion: "1.0.0",
        version,
        plugins: (await this.plugins()).map((plugin) =>
          bundledMarketplaceEntry.parse({
            ...plugin.manifest,
            // Match InstalledPluginRecord.id exactly: the unchanged official
            // tab must resolve the installed record instead of offering install.
            name: plugin.id,
            source: plugin.source,
            version: plugin.version,
          }),
        ),
      },
    };
  }
  async plugin(id: string): Promise<BundledPlugin> {
    return (await this.row("plugin", id)) as unknown as BundledPlugin;
  }
  async skills(templates = false): Promise<BundledSkill[]> {
    return (await db
      .read()
      .catalog.list("skill", templates)) as unknown as BundledSkill[];
  }
  async skill(id: string): Promise<BundledSkill & { body: string }> {
    return (await this.row("skill", id)) as unknown as BundledSkill & {
      body: string;
    };
  }
  async designSystems(): Promise<BundledDesignSystem[]> {
    return (await db
      .read()
      .catalog.list("design-system")) as unknown as BundledDesignSystem[];
  }
  async designSystem(id: string): Promise<BundledDesignSystem> {
    const { manifest, ...summary } = await this.row("design-system", id);
    return summary as unknown as BundledDesignSystem;
  }
  async designSystemDetail(id: string) {
    const { manifest, ...summary } = await this.row("design-system", id);
    return {
      ...summary,
      body: (await this.asset("design-system", id, "DESIGN.md")).toString(
        "utf8",
      ),
      packageInfo: {
        manifest,
        availableFiles: (await this.files("design-system", id)).map(
          (f) => f.path,
        ),
      },
    };
  }
  async files(kind: CatalogKind, id: string) {
    await this.row(kind, id);
    return (await db.read().catalog.files(kind, id)).map((row) => ({
      path: row.path,
      kind: "file" as const,
      size: row.size,
    }));
  }
  async asset(kind: CatalogKind, id: string, path: string) {
    path = path.replace(/^\.\//, "");
    const asset = (await db.read().catalog.files(kind, id)).find(
      (row) => row.path === path,
    );
    if (!asset) throw unavailable();
    return Buffer.from(
      await file.read({
        kind: "bundled",
        path: asset.resourcePath,
        sha256: asset.sha256,
      }),
    );
  }
}
export const defaultBundledCatalog = () => new BundledCatalog();
