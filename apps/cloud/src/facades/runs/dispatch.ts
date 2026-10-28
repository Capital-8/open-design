import {
  runtime,
  BridgeError,
  type OutboxRecord,
  type RuntimeScope,
} from "@open-design/bridge";
import {
  prepareJob,
  completeJob,
  type JobResult,
  type Failure,
} from "@open-design/biz/runs/recovery";
import type { ResourceSelection } from "@open-design/biz/catalog/official";
import {
  applyEvent,
  locked,
  mergeSnapshot,
  mergeRecoverySnapshot,
} from "@open-design/biz/journal";
export function createDispatchFacade(environment: string) {
  async function perform(job: OutboxRecord) {
    const plan = await prepareJob(job, environment);
    if (!plan) return null;
    const { run, scope, project, conversation } = plan,
      session = {
        projectId: project.runtime_project_id!,
        sessionId: conversation.runtime_session_id!,
      };
    let outcome: JobResult;
    try {
      if (plan.action === "submit")
        outcome = {
          kind: "submitted",
          run: await runtime.submitRun(scope, {
            session,
            idempotencyKey: run.id,
            input: run.input,
            ...(Array.isArray(run.legacy?.officialResources)
              ? {
                  resources: run.legacy
                    .officialResources as ResourceSelection[],
                }
              : {}),
          }),
        };
      else if (plan.action === "discover") {
        const snapshot = await runtime.getSnapshot(scope, session),
          found = snapshot.runs.filter(
            (remote) => remote.idempotencyKey === run.id,
          );
        if (found.length > 1) throw new BridgeError("runtime_protocol_error");
        outcome = found[0]
          ? { kind: "submitted", run: found[0] }
          : { kind: "not-found" };
      } else if (!run.runtime_run_id) outcome = { kind: "not-found" };
      else {
        const ref = { ...session, runId: run.runtime_run_id };
        if (plan.action === "cancel") {
          await runtime.cancelRun(scope, ref);
          outcome = { kind: "cancel-accepted" };
        } else {
          const observed =
            plan.action === "recover"
              ? await runtime.recoverRun(scope, ref)
              : await runtime.getRun(scope, ref);
          outcome = {
            kind: "observed",
            run: observed,
            snapshot: await runtime.getSnapshot(scope, session),
          };
        }
      }
    } catch (error) {
      const code =
        error instanceof BridgeError ? error.code : "runtime_unavailable";
      const status =
        error instanceof BridgeError && "status" in error
          ? error.status
          : undefined;
      const authorization =
        [
          "runtime_reauthentication_required",
          "runtime_authorization_expired",
          "runtime_unauthorized",
          "account_restricted",
          "auth_key_unavailable",
          "auth_credential_invalid",
        ].includes(code) || status === 401;
      const failure: Failure = {
        code,
        uncertain: error instanceof BridgeError ? error.uncertain : true,
        authorization,
        rejected:
          plan.action === "submit" &&
          [400, 402, 403, 404, 409, 422].includes(Number(status)),
        ...(error instanceof BridgeError && error.requestId
          ? { requestId: error.requestId }
          : {}),
      };
      outcome = { kind: "failure", failure };
    }
    // Database errors after an external success escape to the scheduler; never classify as execution failure.
    const applied = await completeJob(job, scope.credentialRef, outcome);
    return applied ? { ...plan, outcome } : null;
  }
  function stream(
    scope: RuntimeScope,
    projectId: string,
    sessionId: string,
    cursor: string,
  ) {
    return runtime.streamEvents(scope, { projectId, sessionId }, cursor);
  }
  async function recoverStream(
    scope: RuntimeScope,
    conversationId: string,
    projectId: string,
    sessionId: string,
    observedCursor: string,
  ) {
    const snapshot = await runtime.getSnapshot(scope, { projectId, sessionId });
    return mergeRecoverySnapshot(
      conversationId,
      snapshot,
      scope.credentialRef,
      observedCursor,
    );
  }
  return { perform, stream, applyEvent, recoverStream };
}
export type DispatchFacade = ReturnType<typeof createDispatchFacade>;
