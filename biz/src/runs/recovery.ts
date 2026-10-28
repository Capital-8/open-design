import {
  db,
  type DbTransaction,
  type OutboxRecord,
  type RunRecord,
  type ExecutionRun,
  type ExecutionSnapshot,
  type RuntimeScope,
} from "@open-design/bridge";
import { BizError, unavailable } from "../errors.js";
import { runDTO, terminal } from "../model.js";
import { mergeSnapshot, updateRun, locked } from "../journal/index.js";
export interface Failure {
  code: string;
  uncertain: boolean;
  authorization?: boolean;
  rejected?: boolean;
  requestId?: string;
}
export type JobResult =
  | { kind: "submitted"; run: ExecutionRun }
  | { kind: "observed"; run: ExecutionRun; snapshot: ExecutionSnapshot }
  | { kind: "snapshot"; snapshot: ExecutionSnapshot; replaceCursorAt?: string }
  | { kind: "cancel-accepted" }
  | { kind: "not-found" }
  | { kind: "failure"; failure: Failure };
export async function jobContext(runId: string) {
  const run = await db.read().runs.get(runId);
  if (!run) throw unavailable();
  const conversation = await db.read().conversations.get(run.conversation_id);
  if (!conversation) throw unavailable();
  const project = await db.read().projects.get(conversation.project_id);
  if (!project) throw unavailable();
  return { run, conversation, project };
}
function claimValid(
  current: OutboxRecord | null,
  job: OutboxRecord,
  now: number,
) {
  return (
    !!current &&
    !current.done &&
    current.claim_token === job.claim_token &&
    current.version === job.version &&
    !!current.claimed_until &&
    Date.parse(current.claimed_until) > now
  );
}
async function acknowledge(
  tx: DbTransaction,
  job: OutboxRecord,
  done: boolean,
  attempts: number,
  delayMs: number,
  error: string | null,
  now: number,
) {
  if (
    !(await tx.outbox.finish(job.id, job.claim_token!, job.version, {
      done,
      attempts,
      availableAt: new Date(now + delayMs).toISOString(),
      lastError: error,
    }))
  )
    throw new BizError("job_claim_lost");
}
export async function prepareJob(
  job: OutboxRecord,
  environment: string,
  now = Date.now(),
) {
  const initial = await jobContext(job.run_id);
  return locked(initial.conversation.id, async (tx, c) => {
    const run = await tx.runs.lock(job.run_id),
      claim = await tx.outbox.lock(job.id);
    if (!run || !claimValid(claim, job, now)) return null;
    if (terminal(run.status)) {
      await acknowledge(tx, job, true, job.attempts, 0, null, now);
      return null;
    }
    const p = (await tx.projects.get(c.project_id))!,
      account = await tx.accounts.get(p.owner_id);
    const authorization = run.credential_ref
      ? await tx.credentials.authorization(run.credential_ref)
      : null;
    if (authorization?.reason === "logout") {
      await tx.runs.update(run.id, {
        authorization_state: "revoked",
        error_code: "runtime_reauthentication_required",
      });
      await acknowledge(
        tx,
        job,
        false,
        job.attempts,
        30000,
        "runtime_reauthentication_required",
        now,
      );
      return null;
    }
    if (
      account?.status !== "active" ||
      !run.principal_id ||
      run.principal_id !== p.owner_id ||
      run.provider_environment !== environment ||
      run.workspace_id !== p.workspace_id ||
      !run.credential_ref ||
      run.authorization_state !== "ready"
    ) {
      await tx.runs.update(run.id, {
        authorization_state:
          run.authorization_state === "revoked" ? "revoked" : "waiting",
        error_code: "runtime_reauthentication_required",
      });
      await acknowledge(
        tx,
        job,
        false,
        job.attempts,
        30000,
        "runtime_reauthentication_required",
        now,
      );
      return null;
    }
    if (!p.runtime_project_id || !c.runtime_session_id)
      throw new BizError("resource_not_ready");
    // Persist dispatch uncertainty before any I/O. Crash cannot turn it into a fresh submit.
    const action =
      job.kind === "submit"
        ? run.runtime_run_id
          ? "reconcile"
          : run.submission === "pending"
            ? "submit"
            : "discover"
        : job.kind;
    let updated = run;
    if (action === "submit")
      updated = (await tx.runs.update(
        run.id,
        { submission: "unconfirmed", error_code: "run_unconfirmed" },
        run.revision,
      ))!;
    return {
      run: updated,
      project: p,
      conversation: c,
      action,
      scope: {
        principalId: run.principal_id,
        workspaceId: run.workspace_id!,
        credentialRef: run.credential_ref,
      } satisfies RuntimeScope,
    };
  });
}
export async function completeJob(
  job: OutboxRecord,
  credentialRef: string,
  result: JobResult,
  now = Date.now(),
) {
  const initial = await jobContext(job.run_id);
  return locked(initial.conversation.id, async (tx, c) => {
    let run = await tx.runs.lock(job.run_id);
    const claim = await tx.outbox.lock(job.id);
    if (
      !run ||
      !claimValid(claim, job, now) ||
      run.credential_ref !== credentialRef
    )
      return false;
    if (terminal(run.status)) {
      await acknowledge(tx, job, true, job.attempts, 0, null, now);
      return true;
    }
    const revoked = await tx.credentials.authorization(credentialRef);
    if (revoked?.reason === "logout")
      run = (await tx.runs.update(run.id, {
        authorization_state: "revoked",
        error_code: "runtime_reauthentication_required",
      }))!;
    if (run.authorization_state !== "ready") {
      await acknowledge(
        tx,
        job,
        false,
        job.attempts,
        30000,
        "runtime_reauthentication_required",
        now,
      );
      return false;
    }
    let done = true,
      attempts = job.attempts,
      wait = 0,
      error: string | null = null;
    if (result.kind === "submitted") {
      if (
        result.run.idempotencyKey !== run.id ||
        result.run.ref.sessionId !== c.runtime_session_id
      )
        throw new BizError("runtime_protocol_error");
      if (run.runtime_run_id && run.runtime_run_id !== result.run.ref.runId)
        throw new BizError("runtime_protocol_error");
      run = (await tx.runs.update(run.id, {
        runtime_run_id: result.run.ref.runId,
        submission: "confirmed",
        error_code: null,
      }))!;
      await tx.outbox.enqueue(run.id, "reconcile");
      if (run.cancel_requested) await tx.outbox.enqueue(run.id, "cancel");
      await tx.events.append(c.id, { kind: "run.updated", run: runDTO(run) });
    } else if (result.kind === "observed") {
      if (result.run.ref.runId !== run.runtime_run_id)
        throw new BizError("runtime_protocol_error");
      await mergeSnapshot(tx, c, result.snapshot);
      // The queried terminal fact must be represented by the subsequent canonical snapshot.
      const observed = result.snapshot.runs.find(
        (r) => r.ref.runId === run!.runtime_run_id,
      );
      if (
        terminal(result.run.status) &&
        (!observed || !terminal(observed.status))
      ) {
        done = false;
        wait = 1000;
      } else if (observed) {
        await updateRun(tx, c, observed);
        done = terminal(observed.status);
        wait = 1000;
      } else {
        done = false;
        wait = 1000;
      }
    } else if (result.kind === "snapshot") {
      await mergeSnapshot(tx, c, result.snapshot, result.replaceCursorAt);
      done = false;
      wait = 1000;
    } else if (result.kind === "cancel-accepted") {
      run = (await tx.runs.update(run.id, {
        status: "cancelling",
        cancel_requested: true,
      }))!;
      await tx.events.append(c.id, { kind: "run.updated", run: runDTO(run) });
      await tx.outbox.enqueue(run.id, "reconcile");
    } else if (result.kind === "not-found") {
      done = false;
      wait = 30000;
      error = "run_unconfirmed";
    } else {
      const f = result.failure;
      error = f.code;
      done = false;
      if (f.authorization) {
        await tx.runs.update(run.id, {
          authorization_state: "waiting",
          error_code: "runtime_reauthentication_required",
        });
        wait = 30000;
      } else if (
        job.kind === "submit" &&
        !run.runtime_run_id &&
        f.rejected &&
        !f.uncertain
      ) {
        run = (await tx.runs.update(run.id, {
          submission: "rejected",
          status: "failed",
          error_code: f.code,
        }))!;
        const p = await tx.projects.get(c.project_id);
        if (p?.active_run_id === run.id)
          await tx.projects.update(p.id, { active_run_id: null });
        await tx.events.append(c.id, { kind: "run.updated", run: runDTO(run) });
        done = true;
      } else {
        attempts++;
        wait = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5));
        await tx.runs.update(run.id, {
          error_code: run.runtime_run_id
            ? "recovery_unconfirmed"
            : "run_unconfirmed",
          upstream_request_id: f.requestId ?? null,
        });
      }
    }
    await acknowledge(tx, job, done, attempts, wait, error, now);
    return true;
  });
}
export async function recoverIntents() {
  for (const item of await db.read().runs.unfinished())
    await locked(item.conversation_id, async (tx) => {
      const run = await tx.runs.lock(item.id);
      if (!run || terminal(run.status)) return;
      await tx.outbox.enqueue(
        run.id,
        run.runtime_run_id ? "reconcile" : "submit",
      );
      if (run.cancel_requested) await tx.outbox.enqueue(run.id, "cancel");
    });
}
export async function revokeTasks(principalId: string, credentialRef: string) {
  for (const item of await db.read().runs.unfinished())
    if (
      item.principal_id === principalId &&
      item.credential_ref === credentialRef
    )
      await locked(item.conversation_id, async (tx) => {
        const run = await tx.runs.lock(item.id);
        if (
          !run ||
          terminal(run.status) ||
          run.credential_ref !== credentialRef
        )
          return;
        await tx.runs.update(run.id, {
          authorization_state: "revoked",
          error_code: "runtime_reauthentication_required",
        });
      });
}
/** Explicit reauthorization only: same principal/environment and freshly verified original workspace. */
export async function reauthorizeTask(input: {
  runId: string;
  principalId: string;
  environment: string;
  workspaceId: string;
  credentialRef: string;
}) {
  const a = await jobContext(input.runId);
  return locked(a.conversation.id, async (tx) => {
    const run = await tx.runs.lock(input.runId);
    if (
      !run ||
      run.principal_id !== input.principalId ||
      run.provider_environment !== input.environment ||
      run.workspace_id !== input.workspaceId
    )
      throw new BizError("reauthorization_scope_mismatch");
    if (
      (run.credential_ref &&
        (await tx.credentials.authorization(run.credential_ref))?.reason ===
          "logout") ||
      terminal(run.status) ||
      run.cancel_requested ||
      run.authorization_state === "revoked"
    )
      throw new BizError("reauthorization_unavailable");
    const updated = (await tx.runs.update(run.id, {
      credential_ref: input.credentialRef,
      authorization_state: "ready",
      error_code: null,
    }))!;
    await tx.outbox.enqueue(
      run.id,
      run.runtime_run_id ? "reconcile" : "submit",
    );
    return updated;
  });
}
