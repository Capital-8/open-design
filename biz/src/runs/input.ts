import { legacyRunInput } from "@open-design/contracts/cloud/legacy-chat";
import { allowOnly } from "../projects/input.js";
import { BizError } from "../errors.js";
import type { ProjectRecord } from "@open-design/bridge";
export function runInput(input: unknown) {
  const parsed = legacyRunInput.safeParse(input);
  if (!parsed.success) throw new BizError("invalid_input");
  const v = parsed.data;
  allowOnly(v, [
    "agentId",
    "message",
    "currentPrompt",
    "attachments",
    "priorTranscript",
    "projectId",
    "conversationId",
    "userMessageId",
    "assistantMessageId",
    "clientRequestId",
    "sessionMode",
    "locale",
    "analyticsHints",
    "titleGeneration",
    "model",
    "context",
    "mediaExecution",
    "skillId",
    "skillIds",
    "designSystemId",
    "pluginId",
    "pluginSource",
    "pluginInputs",
    "appliedPluginSnapshotId",
  ]);
  if (
    (v.sessionMode && !["design", "chat"].includes(String(v.sessionMode))) ||
    (v.model && v.model !== "cloud-runtime-default")
  )
    throw new BizError("unsupported_feature");
  return v;
}
export function runContext(
  v: ReturnType<typeof runInput>,
  project: ProjectRecord,
) {
  const promptContext = {
    priorTranscript: v.priorTranscript ?? "",
    locale: v.locale ?? null,
    context: v.context ?? null,
  };
  if (Buffer.byteLength(JSON.stringify(promptContext)) > 98304)
    throw new BizError("input_context_too_large");
  const hasStrategy = "strategyBinding" in project.metadata_json;
  if (!hasStrategy && v.context?.workspaceItems?.length)
    throw new BizError("unsupported_feature");
  return hasStrategy;
}
