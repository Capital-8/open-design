import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { submitRun as nativeInput } from "@open-design/contracts/cloud/api";
import { setTimeout as delay } from "node:timers/promises";
import { runView } from "@open-design/biz/views";
import {
  terminal,
  projectDTO,
  conversationDTO,
  runDTO,
  messageDTO,
} from "@open-design/biz/model";
import { framesFor, messagesView } from "@open-design/biz/runs/views";
import { BizError } from "@open-design/biz/errors";
import type { RunFacade } from "../facades/runs/index.js";
import type { ProjectFacade } from "../facades/projects/index.js";
import type { HttpIdentity } from "../http/auth-context.js";
import { scopeRequest } from "../http/scope.js";
import { jsonBody, parameter } from "../http/input.js";
import { writeEvent, writeStream } from "../http/sse.js";
export function runRoutes(
  app: Express,
  facade: RunFacade,
  projects: ProjectFacade,
  http: HttpIdentity,
) {
  app.post("/api/conversations/:id/runs", async (req, res) => {
    const ctx = await http.context(req, res),
      cid = parameter(req.params.id),
      parsed = nativeInput.safeParse(jsonBody(req));
    if (!parsed.success) throw new BizError("invalid_input");
    const value = await facade.snapshot(ctx, cid, scopeRequest(req));
    const r = await facade.submit(
      ctx,
      {
        agentId: "amr",
        projectId: value.project.id,
        conversationId: cid,
        clientRequestId: parsed.data.clientRequestId,
        message: parsed.data.input,
        userMessageId: parsed.data.clientRequestId,
        assistantMessageId: parsed.data.clientRequestId + ":assistant",
      },
      scopeRequest(req),
    );
    res.status(202).json(runDTO(r));
  });
  app.get("/api/conversations/:id/events", async (req, res) => {
    const ctx = await http.context(req, res),
      cid = parameter(req.params.id);
    let cursor = req.get("Last-Event-ID") ?? "0";
    await facade.events(ctx, cid, cursor, scopeRequest(req));
    const abort = new AbortController(),
      close = () => abort.abort();
    res.once("close", close);
    res
      .set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      })
      .flushHeaders();
    try {
      while (!abort.signal.aborted) {
        const rows = await facade.events(ctx, cid, cursor, scopeRequest(req));
        for (const row of rows) {
          await writeEvent(
            res,
            abort.signal,
            String(row.body.kind),
            {
              sequence: row.sequence,
              conversationId: cid,
              time: row.created_at,
              payload: row.body,
            },
            row.sequence,
          );
          cursor = row.sequence;
        }
        if (rows.length === 200) continue;
        await writeStream(res, abort.signal, ": heartbeat\n\n");
        await delay(1000, undefined, { signal: abort.signal });
      }
    } catch {
      if (!abort.signal.aborted)
        await writeEvent(res, abort.signal, "error", {
          code: "stream_interrupted",
          message: "Reconnect from the last received cursor",
        }).catch(() => {});
    } finally {
      res.off("close", close);
      abort.abort();
      if (!res.destroyed) res.end();
    }
  });
  app.post("/api/runs/:id/reauthorize", async (req, res) =>
    res.json(
      runDTO(
        await facade.reauthorize(
          await http.context(req, res),
          parameter(req.params.id),
          scopeRequest(req),
        ),
      ),
    ),
  );
  app.post("/api/runs", async (req, res) => {
    const run = await facade.submit(
      await http.context(req, res),
      jsonBody(req),
      scopeRequest(req),
    );
    res
      .status(202)
      .json({
        runId: run.id,
        conversationId: run.conversation_id,
        assistantMessageId: run.legacy?.assistantMessageId,
      });
  });
  app.get("/api/runs", async (req, res) => {
    const values = await facade.list(
      await http.context(req, res),
      scopeRequest(req),
      typeof req.query.projectId === "string" ? req.query.projectId : undefined,
      typeof req.query.conversationId === "string"
        ? req.query.conversationId
        : undefined,
    );
    res.json({
      runs: values.map((v) => runView(v.run, v.projectId)),
      awaitingInputProjectIds: [],
    });
  });
  app.get("/api/runs/:id", async (req, res) => {
    const value = await facade.run(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json(runView(value.r, value.p.id));
  });
  app.post("/api/runs/:id/cancel", async (req, res) => {
    await facade.cancel(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.status(202).json({ ok: true, cancelOrigin: "user_stop" });
  });
  app.get("/api/conversations/:id", async (req, res) => {
    const s = await facade.snapshot(
      await http.context(req, res),
      parameter(req.params.id),
      scopeRequest(req),
    );
    res.json({
      project: projectDTO(s.project),
      conversation: conversationDTO(s.conversation),
      runs: s.runs.map(runDTO),
      messages: s.messages.map(messageDTO),
      cursor: s.cursor,
    });
  });
  app.get("/api/projects/:id/conversations/:cid/messages", async (req, res) => {
    const ctx = await http.context(req, res),
      pid = parameter(req.params.id),
      cid = parameter(req.params.cid);
    await projects.conversation(ctx, pid, cid, scopeRequest(req));
    const value = await facade.snapshot(ctx, cid, scopeRequest(req));
    res.json({ messages: messagesView(value.messages, value.runs) });
  });
  app.put(
    "/api/projects/:id/conversations/:cid/messages/:mid",
    async (req, res) => {
      const ctx = await http.context(req, res),
        v = jsonBody(req),
        pid = parameter(req.params.id),
        cid = parameter(req.params.cid),
        mid = parameter(req.params.mid);
      await projects.conversation(ctx, pid, cid, scopeRequest(req));
      if (v.id !== mid || typeof v.content !== "string")
        throw new BizError("invalid_input");
      const value = await facade.snapshot(ctx, cid, scopeRequest(req)),
        saved = messagesView(value.messages, value.runs).find(
          (m) => m.id === mid,
        );
      if (saved) {
        res.json({ message: saved });
        return;
      }
      if (v.role !== "user") throw new BizError("unsupported_feature");
      const draft = await facade.draft(
        ctx,
        pid,
        cid,
        mid,
        v.content,
        scopeRequest(req),
      );
      res.json({
        message: {
          id: mid,
          role: "user",
          content: draft.content,
          createdAt: Date.parse(draft.created_at),
        },
      });
    },
  );
  app.get("/api/runs/:id/events", async (req, res) => {
    const ctx = await http.context(req, res),
      initial = await facade.run(
        ctx,
        parameter(req.params.id),
        scopeRequest(req),
      ),
      raw = req.query.after ?? req.get("Last-Event-ID") ?? "0";
    if (typeof raw !== "string" || !/^(0|[1-9]\d{0,8})$/.test(raw))
      throw new BizError("invalid_input");
    let cursor = Number(raw);
    const abort = new AbortController(),
      close = () => abort.abort();
    res.once("close", close);
    try {
      let frames = await framesFor(initial.r);
      if (cursor > frames.length) throw new BizError("invalid_input");
      res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      while (!abort.signal.aborted) {
        const { r } = await facade.run(ctx, initial.r.id, scopeRequest(req));
        frames = await framesFor(r);
        for (; cursor < frames.length; cursor++) {
          const frame = frames[cursor]!;
          await writeEvent(
            res,
            abort.signal,
            frame.event,
            frame.data,
            String(cursor + 1),
          );
        }
        if (terminal(r.status) || r.status === "blocked") break;
        await writeStream(res, abort.signal, ": heartbeat\n\n");
        await delay(500, undefined, { signal: abort.signal });
      }
    } catch (error) {
      if (!res.headersSent) throw error;
      if (!abort.signal.aborted)
        await writeEvent(res, abort.signal, "error", {
          code: error instanceof BizError ? error.code : "stream_interrupted",
          message: "Stream interrupted",
        }).catch(() => {});
    } finally {
      res.off("close", close);
      abort.abort();
      if (res.headersSent && !res.destroyed) res.end();
    }
  });
}
