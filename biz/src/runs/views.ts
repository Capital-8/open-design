import { db, type RunRecord, type MessageRecord } from "@open-design/bridge";
import { eventPayload } from "@open-design/contracts/cloud/api";
import type { LegacyFrame } from "@open-design/contracts/cloud/legacy-chat";
import { terminal } from "../model.js";
import { status } from "../views.js";
import { BizError } from "../errors.js";
export function messagesView(messages: MessageRecord[], runs: RunRecord[]) {
  const output: {
    id: string;
    role: string;
    content: string;
    createdAt: number;
    runId: string;
    runStatus: string;
    agentId: string;
    agentName: string;
  }[] = [];
  for (const message of messages) {
    if (!["user", "assistant"].includes(message.role)) continue;
    const run = runs.find((r) => r.id === message.run_id);
    if (!run) continue;
    const key =
        message.role === "user" ? "userMessageId" : "assistantMessageId",
      id =
        typeof run.legacy?.[key] === "string"
          ? String(run.legacy[key])
          : message.id,
      previous = output.find((v) => v.id === id);
    if (previous) previous.content += message.content;
    else
      output.push({
        id,
        role: message.role,
        content: message.content,
        createdAt: Date.parse(message.created_at),
        runId: message.run_id,
        runStatus: status(run),
        agentId: "amr",
        agentName: "OpenDesign Cloud",
      });
  }
  return output;
}
export async function framesFor(run: RunRecord): Promise<LegacyFrame[]> {
  const frames: LegacyFrame[] = [
      { event: "start", data: { runId: run.id, bin: "Cloud Runtime" } },
    ],
    textByTurn = new Map<string, string>();
  let cursor = "0";
  for (;;) {
    const rows = await db
      .read()
      .events.after(run.conversation_id, cursor, 1000);
    for (const row of rows) {
      cursor = row.sequence;
      const parsed = eventPayload.safeParse(row.body);
      if (!parsed.success) continue;
      const e = parsed.data;
      if (
        "runId" in e
          ? e.runId !== run.id
          : e.kind === "run.updated"
            ? e.run.id !== run.id
            : true
      )
        continue;
      if (e.kind === "message.delta" && e.delta.text) {
        const turn = e.delta.turn ?? "";
        textByTurn.set(turn, (textByTurn.get(turn) ?? "") + e.delta.text);
        frames.push({ event: "stdout", data: { chunk: e.delta.text } });
      } else if (
        e.kind === "message.complete" &&
        e.message.role === "assistant"
      ) {
        const turn = e.message.turn ?? "",
          prior = textByTurn.get(turn) ?? "";
        if (e.message.content.startsWith(prior)) {
          const rest = e.message.content.slice(prior.length);
          if (rest) frames.push({ event: "stdout", data: { chunk: rest } });
          textByTurn.set(turn, e.message.content);
        }
      } else if (e.kind === "tool.state")
        frames.push({
          event: "agent",
          data: {
            type: "status",
            label: "running",
            detail: e.call?.name ?? e.status ?? "tool",
          },
        });
    }
    if (rows.length < 1000) break;
    if (frames.length > 100000) throw new BizError("event_history_too_large");
  }
  if (terminal(run.status) || run.status === "blocked") {
    const messages = (
      await db.read().messages.forConversation(run.conversation_id)
    ).filter((m) => m.run_id === run.id && m.role === "assistant");
    for (const m of messages) {
      const prior = textByTurn.get(m.turn ?? "") ?? "";
      if (m.content.startsWith(prior)) {
        const rest = m.content.slice(prior.length);
        if (rest) frames.push({ event: "stdout", data: { chunk: rest } });
        textByTurn.set(m.turn ?? "", m.content);
      }
    }
    if (run.status !== "succeeded")
      frames.push({
        event: "error",
        data: {
          message: run.error_code ?? `Cloud run ${run.status}`,
          code: run.error_code ?? run.status,
        },
      });
    frames.push({
      event: "end",
      data: {
        status: status(run),
        code: run.status === "succeeded" ? 0 : 1,
        signal: null,
      },
    });
  }
  return frames;
}
