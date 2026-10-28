import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  db,
  type OutboxRecord,
  type RuntimeEventStream,
} from "@open-design/bridge";
import { recoverIntents, jobContext } from "@open-design/biz/runs/recovery";
import { recoverOperations } from "@open-design/biz/projects";
import { terminal } from "@open-design/biz/model";
import type { DispatchFacade } from "../../facades/runs/dispatch.js";
export interface WorkerLease {
  readonly healthy: boolean;
  close(): Promise<void>;
}
export class RunWorker {
  private readonly ownerId = randomUUID();
  private readonly abort = new AbortController();
  private owner: WorkerLease | undefined;
  private loop: Promise<void> | undefined;
  private readonly streams = new Map<
    string,
    { credentialRef: string; handle: RuntimeEventStream; task: Promise<void> }
  >();
  constructor(
    private readonly facade: DispatchFacade,
    private readonly acquire: (lost: () => void) => Promise<WorkerLease>,
    private readonly log: (record: Record<string, unknown>) => void = () => {},
    private readonly onLost: () => void = () => {},
  ) {}
  get healthy() {
    return !!this.owner?.healthy && !this.abort.signal.aborted;
  }
  async start() {
    this.owner = await this.acquire(() => {
      if (this.abort.signal.aborted) return;
      this.quiesce();
      this.log({ event: "worker_ownership_lost" });
      this.onLost();
    });
    try {
      await recoverOperations();
      await recoverIntents();
      if (!this.healthy) throw new Error("worker_ownership_lost");
      this.loop = this.pump();
    } catch (error) {
      await this.owner.close();
      this.owner = undefined;
      throw error;
    }
  }
  private async pump() {
    while (!this.abort.signal.aborted) {
      try {
        await this.tick();
      } catch {
        this.log({ event: "worker_poll_failed" });
      }
      await delay(500, undefined, { signal: this.abort.signal }).catch(
        () => {},
      );
    }
  }
  async tick() {
    if (!this.healthy) return;
    const claims = await db.transaction((tx) =>
      tx.outbox.claim(this.ownerId, randomUUID(), 8, 60000),
    );
    if (!this.healthy) return;
    await Promise.allSettled(claims.map((job) => this.perform(job)));
  }
  private async perform(job: OutboxRecord) {
    if (!this.healthy) return;
    let valid = true;
    let renewing = Promise.resolve();
    const timer = setInterval(() => {
      renewing = renewing
        .then(async () => {
          if (!this.healthy) {
            valid = false;
            return;
          }
          if (
            !(await db.transaction((tx) =>
              tx.outbox.renew(job.id, job.claim_token!, job.version, 60000),
            ))
          )
            valid = false;
        })
        .catch(() => {
          valid = false;
        });
    }, 15000);
    timer.unref();
    try {
      const result = await this.facade.perform(job);
      if (!valid || this.abort.signal.aborted || !result) return;
      if (
        result.outcome.kind === "failure" &&
        result.outcome.failure.authorization
      )
        this.closeCredential(result.scope.credentialRef);
      const context = await jobContext(job.run_id);
      if (
        context.run.runtime_run_id &&
        !terminal(context.run.status) &&
        context.run.authorization_state === "ready"
      )
        this.ensureStream({
          ...result,
          run: context.run,
          conversation: context.conversation,
          project: context.project,
        });
    } catch (error) {
      this.log({
        event: "job_confirmation_pending",
        runId: job.run_id,
        kind: job.kind,
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "unconfirmed",
      });
    } finally {
      clearInterval(timer);
      await renewing;
    }
  }
  private ensureStream(
    value: NonNullable<Awaited<ReturnType<DispatchFacade["perform"]>>>,
  ) {
    const c = value.conversation;
    if (this.streams.has(c.id) || !this.healthy) return;
    const handle = this.facade.stream(
      value.scope,
      value.project.runtime_project_id!,
      c.runtime_session_id!,
      c.runtime_cursor,
    );
    const task = (async () => {
      try {
        for await (const event of handle) {
          if (!this.healthy) break;
          await this.facade.applyEvent(c.id, event, value.scope.credentialRef);
          if (
            event.kind === "status" &&
            typeof event.payload.status === "string" &&
            terminal(event.payload.status)
          )
            break;
        }
      } catch (error) {
        if (
          !this.abort.signal.aborted &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "invalid_cursor"
        ) {
          const latest = await db.read().conversations.get(c.id);
          if (latest)
            await this.facade.recoverStream(
              value.scope,
              c.id,
              value.project.runtime_project_id!,
              c.runtime_session_id!,
              latest.runtime_cursor,
            );
        }
      } finally {
        handle.close();
        this.streams.delete(c.id);
      }
    })().catch(() => {
      this.log({ event: "stream_reconnect_pending", conversationId: c.id });
    });
    this.streams.set(c.id, {
      credentialRef: value.scope.credentialRef,
      handle,
      task,
    });
  }
  closeCredential(ref: string) {
    for (const entry of this.streams.values())
      if (entry.credentialRef === ref) entry.handle.close();
  }
  quiesce() {
    this.abort.abort();
    for (const entry of this.streams.values()) entry.handle.close();
  }
  async stop() {
    this.quiesce();
    await this.loop;
    await Promise.allSettled(
      [...this.streams.values()].map((entry) => entry.task),
    );
    await this.owner?.close();
    this.owner = undefined;
  }
}
