import { z } from "zod";
import { legacyWorkspaceSelection } from "./legacy-workspace.js";
// Home reference pills use the existing client metadata shape. Only identity
// is used for resource lookup; display text cannot choose a binding or path.
export const contextPlugins = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
        title: z.string().trim().min(1).max(1024),
        description: z.string().max(16384).optional(),
      })
      .strict(),
  )
  .max(8);
export const legacyProjectMetadata = z
  .object({
    contextPlugins: contextPlugins.optional(),
  })
  .passthrough();
export const exampleReference = z
  .object({
    pluginId: z.string().trim().min(1).max(256),
    source: z.string().trim().min(1).max(4096),
  })
  .strict();
export const strategyTaskProfile = z.enum([
  "prototype",
  "ppt",
  "marketing",
  "hyperframes",
  "motion-design",
]);
export const strategyBinding = z
  .object({
    schemaVersion: z.literal(1),
    provenance: z.literal("automatic_default"),
    taskProfile: strategyTaskProfile,
    boundAt: z.number().int().nonnegative(),
  })
  .strict();
export const runContextSelection = z
  .object({
    skillIds: z.array(z.string().max(128)).max(8).optional(),
    pluginIds: z.array(z.string().max(128)).max(8).optional(),
    mcpServerIds: z.array(z.string()).max(0).optional(),
    connectorIds: z.array(z.string()).max(0).optional(),
    workspaceItems: z
      .array(
        z
          .object({
            id: z.string().max(256),
            kind: z.string().max(64),
            label: z.string().max(1024),
            tabId: z.string().max(256).optional(),
            path: z.string().max(4096).optional(),
            absolutePath: z.string().max(4096).optional(),
            url: z.string().max(4096).optional(),
            title: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
  })
  .strict();
// Wire subset of the original Open Design client, aligned with upstream 45a6fd80b2.
// Unknown semantic capabilities are rejected by the adapter, never silently run.
export const legacyProjectInput = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(256),
    pluginId: z.string().max(128).nullable().optional(),
    pluginSource: z.string().max(4096).nullable().optional(),
    pluginInputs: z
      .record(
        z.union([z.string().max(16384), z.number().finite(), z.boolean()]),
      )
      .optional(),
    appliedPluginSnapshotId: z.string().max(32768).nullable().optional(),

    skillId: z.string().nullable().optional(),
    skillCatalogScope: legacyWorkspaceSelection.strict().nullable().optional(),
    designSystemId: z.string().nullable().optional(),
    designSystemCatalogScope: legacyWorkspaceSelection
      .strict()
      .nullable()
      .optional(),
    pendingPrompt: z.string().max(65536).optional(),
    metadata: legacyProjectMetadata.optional(),
    conversationMode: z.string().optional(),
    projectLocationId: z.string().optional(),
    automaticStrategyTaskProfile: strategyTaskProfile.optional(),
    exampleReference: exampleReference.optional(),
  })
  .passthrough();
export const legacyRunInput = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    clientRequestId: z.string().min(1).max(128),
    agentId: z.literal("amr"),
    message: z.string(),
    skillId: z.string().max(128).nullable().optional(),
    skillIds: z.array(z.string().max(128)).max(8).optional(),
    designSystemId: z.string().max(128).nullable().optional(),
    pluginId: z.string().max(128).nullable().optional(),
    pluginSource: z.string().max(4096).nullable().optional(),
    pluginInputs: z
      .record(
        z.union([z.string().max(16384), z.number().finite(), z.boolean()]),
      )
      .optional(),
    appliedPluginSnapshotId: z.string().max(32768).nullable().optional(),
    currentPrompt: z.string().optional(),
    priorTranscript: z.string().optional(),
    attachments: z.array(z.string().min(1).max(4096)).max(12).optional(),
    locale: z.string().max(64).optional(),
    context: runContextSelection.optional(),
    mediaExecution: z
      .object({
        mode: z.enum(["enabled", "disabled"]),
        allowedSurfaces: z
          .array(z.enum(["image", "video", "audio"]))
          .max(3)
          .optional(),
        allowedModels: z.array(z.string().min(1).max(256)).max(64).optional(),
      })
      .strict()
      .optional(),
    userMessageId: z.string().min(1).max(128),
    assistantMessageId: z.string().min(1).max(128),
  })
  .passthrough();
export type LegacyFrame = { event: string; data: Record<string, unknown> };
