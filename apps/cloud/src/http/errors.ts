import type { ErrorRequestHandler } from "express";
import { BridgeError } from "@open-design/bridge";
import { DependencyError, HttpFailure } from "@open-design/dependencies";
import { BizError } from "@open-design/biz/errors";
const statuses: Record<string, number> = {
  unauthorized: 401,
  runtime_reauthentication_required: 401,
  account_restricted: 403,
  forbidden: 403,
  untrusted_origin: 403,
  resource_unavailable: 404,
  invalid_input: 400,
  invalid_login_request: 400,
  invalid_privacy_choice: 400,
  workspace_selection_required: 400,
  workspace_selection_unavailable: 409,
  workspace_unavailable: 409,
  project_busy: 409,
  resource_not_ready: 409,
  creation_unknown: 409,
  conflict: 409,
  input_changed: 409,
  recovery_pending: 409,
  db_conflict: 409,
  db_transaction_conflict: 409,
  unsupported_feature: 501,
  cloud_memory_unavailable: 501,
  cloud_library_unavailable: 501,
  catalog_read_only: 501,
  preview_unavailable: 404,
  binary_resource: 422,
  github_unavailable: 502,
};
export const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  const known =
    error instanceof BizError ||
    error instanceof BridgeError ||
    error instanceof DependencyError;
  const code = known ? error.code : "internal_error";
  const status =
    error instanceof HttpFailure ||
    (error instanceof BridgeError &&
      "status" in error &&
      Number.isInteger(error.status) &&
      Number(error.status) >= 400 &&
      Number(error.status) <= 599)
      ? Number(error.status)
      : (statuses[code] ??
        (code.startsWith("invalid_")
          ? 400
          : code.includes("too_large") || code.includes("quota_exceeded")
            ? 413
            : code.includes("unsupported")
              ? 501
              : known
                ? 503
                : 500));
  res
    .set("X-Error-Code", code)
    .status(status)
    .json({
      code,
      message: error instanceof BizError ? error.message : code,
      requestId: res.locals.requestId,
      retryable: error instanceof BizError ? error.retryable : status >= 500,
      ...(error instanceof BridgeError || error instanceof DependencyError
        ? { uncertain: error.uncertain }
        : {}),
    });
};
