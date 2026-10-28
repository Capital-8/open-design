import type { DataObject } from "./records.js";
export type CatalogKind = "plugin" | "skill" | "design-system";
export interface CatalogAsset {
  path: string;
  resourcePath: string;
  sha256: string;
  size: number;
}
/** Immutable build snapshot; unavailable inside a business transaction. */
export interface CatalogRead {
  digest(): Promise<string>;
  officialMetadata(): Promise<DataObject>;
  list(kind: CatalogKind, templates?: boolean): Promise<DataObject[]>;
  get(kind: CatalogKind, id: string): Promise<DataObject | null>;
  files(kind: CatalogKind, id: string): Promise<CatalogAsset[]>;
}
