import { z } from "zod";

// Preview filenames come from the pinned resource inventory, never a request.
const previewFile = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+\/[a-f0-9]+\/[a-zA-Z0-9_.-]+$/);
export const bakedPreviewManifest = z.object({
  previews: z.record(
    z.object({
      poster: previewFile,
      video: previewFile,
      holdMs: z.number().nonnegative().optional(),
    }),
  ),
});

// Read-only wire subset of the original client's InstalledPluginRecord.
export const bundledManifest = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    title: z.string(),
    version: z.string(),
    publishedAt: z.string().optional(),
    od: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type BundledPlugin = {
  id: string;
  title: string;
  version: string;
  sourceKind: "bundled";
  source: string;
  sourceDigest: string;
  trust: "bundled";
  capabilitiesGranted: string[];
  manifest: z.infer<typeof bundledManifest>;
  fsPath: string;
  installedAt: number;
  updatedAt: number;
};

// Official market entries describe the same bundled records, not a remotely
// refreshed registry or a per-user installation. Keep locale metadata because
// the original official tab renders these entries before joining installations.
export const bundledMarketplaceEntry = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1),
  title: z.string(),
  title_i18n: z.record(z.string()).optional(),
  description: z.string().optional(),
  description_i18n: z.record(z.string()).optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type BundledSkill = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  mode: string;
  surface: string;
  source: "built-in";
  previewType: string;
  designSystemRequired: boolean;
  defaultFor: string[];
  upstream: string | null;
  hasBody: boolean;
  examplePrompt: string;
  aggregatesExamples: boolean;
  [key: string]: unknown;
};
