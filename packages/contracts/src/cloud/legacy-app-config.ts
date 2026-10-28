import { z } from "zod";

// Temporary original-client consent contract. POC-016 tracks moving ownership
// to the cloud frontend; this is not a general desktop settings store.
export const legacyPrivacyChoice = z.object({
  privacyDecisionAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  installationId: z.string().min(1).max(128).nullable().optional(),
  telemetry: z.object({
    metrics: z.boolean(),
    content: z.boolean(),
    artifactManifest: z.boolean().optional(),
  }),
});
export type LegacyPrivacyChoice = z.infer<typeof legacyPrivacyChoice>;
