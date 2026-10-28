import { z } from "zod";

// Read-only subset of the original DesignSystemSummary/Detail wire contract.
// This describes shipped resources, not a user's installed or editable system.
export const bundledDesignSystemManifest = z.object({
  schemaVersion: z.string(),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  category: z.string().default("Uncategorized"),
  description: z.string().optional(),
  files: z.record(z.string()).optional(),
  usage: z.string().optional(),
  componentsManifest: z.string().optional(),
  importMode: z.string().optional(),
  source: z
    .object({
      type: z.string().optional(),
      url: z.string().optional(),
      branch: z.string().optional(),
      commit: z.string().optional(),
    })
    .optional(),
  craft: z
    .object({
      applies: z.array(z.string()).optional(),
      suggested: z.array(z.string()).optional(),
      exemptions: z.array(z.string()).optional(),
    })
    .optional(),
  fonts: z
    .array(
      z.object({
        family: z.string().optional(),
        weight: z.union([z.string(), z.number()]).optional(),
        style: z.string().optional(),
        file: z.string().optional(),
      }),
    )
    .optional(),
  sourceFiles: z.record(z.string()).optional(),
  assetsDir: z.string().optional(),
  preview: z
    .object({
      dir: z.string().optional(),
      pages: z
        .array(
          z.object({
            path: z.string(),
            role: z.string().optional(),
            title: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type BundledDesignSystem = {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
  source: "built-in";
  status: "published";
  isEditable: false;
  canMutate: false;
};
