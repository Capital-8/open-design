import { randomUUID } from "node:crypto";
import { db, type DataObject } from "@open-design/bridge";
import { legacyProjectInput } from "@open-design/contracts/cloud/legacy-chat";
import { BizError } from "../errors.js";
import { bindStrategy } from "../prompts/strategy.js";
import { bindExample } from "../prompts/example.js";
import { selectionsFor } from "../catalog/selection.js";
import type { WorkspaceMembership } from "../workspaces/index.js";
export function allowOnly(
  value: Record<string, unknown>,
  fields: readonly string[],
) {
  for (const [key, v] of Object.entries(value))
    if (
      !fields.includes(key) &&
      v !== undefined &&
      v !== null &&
      v !== false &&
      v !== "" &&
      !(Array.isArray(v) && !v.length)
    )
      throw new BizError("unsupported_feature");
}
export async function projectInput(
  owner: string,
  item: WorkspaceMembership,
  input: unknown,
) {
  const parsed = legacyProjectInput.safeParse(input);
  if (!parsed.success) throw new BizError("invalid_input");
  const v = parsed.data;
  allowOnly(v, [
    "id",
    "name",
    "pendingPrompt",
    "metadata",
    "conversationMode",
    "projectLocationId",
    "pluginInputs",
    "automaticStrategyTaskProfile",
    "exampleReference",
    "skillId",
    "skillCatalogScope",
    "designSystemId",
    "designSystemCatalogScope",
    "pluginId",
    "pluginSource",
    "appliedPluginSnapshotId",
  ]);
  for (const scope of [v.skillCatalogScope, v.designSystemCatalogScope])
    if (
      scope &&
      (scope.workspaceId !== item.workspaceId ||
        scope.workspaceMemberId !== item.workspaceMemberId)
    )
      throw new BizError("catalog_scope_mismatch");
  if (
    v.pluginInputs &&
    !v.pluginId &&
    !v.appliedPluginSnapshotId &&
    (Object.keys(v.pluginInputs).some((k) => k !== "prompt") ||
      (v.pluginInputs.prompt !== undefined &&
        v.pluginInputs.prompt !== v.pendingPrompt))
  )
    throw new BizError("unsupported_feature");
  if (
    (v.conversationMode && !["design", "chat"].includes(v.conversationMode)) ||
    (v.projectLocationId && v.projectLocationId !== "default")
  )
    throw new BizError("unsupported_feature");
  const previous = await db.read().projects.get(v.id);
  if (previous && previous.owner_id !== owner)
    throw new BizError("resource_unavailable");
  if (
    v.metadata &&
    ("officialResources" in v.metadata || "officialPluginInputs" in v.metadata)
  )
    throw new BizError("invalid_input");
  if (
    v.exampleReference &&
    (!v.automaticStrategyTaskProfile || v.pluginId || v.appliedPluginSnapshotId)
  )
    throw new BizError("invalid_example_reference");
  const metadata: DataObject = await bindStrategy(
    v.metadata ?? {},
    v.automaticStrategyTaskProfile,
    v.conversationMode,
    previous ?? undefined,
  );
  Object.assign(
    metadata,
    await bindExample(v.exampleReference, previous?.metadata_json),
  );
  const selected = await selectionsFor(v, metadata);
  if (selected.selection.length) {
    metadata.officialResources = selected.selection;
    metadata.officialPluginInputs = selected.inputs;
  }
  const cid =
    typeof previous?.legacy?.defaultConversationId === "string"
      ? previous.legacy.defaultConversationId
      : randomUUID();
  return {
    id: v.id,
    name: v.name,
    metadata,
    legacy: {
      workspaceId: item.workspaceId,
      defaultConversationId: cid,
      initialPrompt: v.pendingPrompt ?? "",
    },
    selected: selected.selection,
    conversationId: cid,
  };
}
