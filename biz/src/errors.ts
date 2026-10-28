export class BizError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "BizError";
  }
}
export const unavailable = () =>
  new BizError("resource_unavailable", "Resource is unavailable");
export const busy = () =>
  new BizError("project_busy", "Project has unfinished work");
