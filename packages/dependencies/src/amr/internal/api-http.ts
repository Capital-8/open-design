import { z } from "zod";
import { DependencyError, HttpFailure } from "../../error.js";
import { baseUrl, json, safeCode } from "../../internal/http.js";
import type { AmrApiClientOptions } from "../types.js";
export const workspacePath = (id: string) =>
  "/api/v1/workspaces/" + encodeURIComponent(id);
/** Account API uses the control key; retain existing wire headers and error vocabulary. */
export function createApiRequest<Context>(
  options: AmrApiClientOptions<Context>,
) {
  const url = baseUrl(options.apiUrl),
    fetcher = options.fetch ?? fetch;
  async function request<T>(
    context: Context,
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ) {
    const token = await options.authorize(context);
    let response: Response;
    try {
      response = await fetcher(url + path, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
          Authorization: "Bearer " + token,
        },
      });
    } catch {
      throw new DependencyError("vela_unavailable", init.method === "POST");
    }
    if (!response.ok) {
      const value = await json(response, 65536).catch(() => null);
      const body =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      const known = [
        "invite_existing_member",
        "invite_duplicate",
        "workspace_seat_limit_reached",
        "workspace_subscription_seat_allocation_unavailable",
      ];
      const code =
        typeof body.error === "string" && known.includes(body.error)
          ? body.error
          : safeCode(body.code, "vela_upstream_error");
      throw new HttpFailure(
        response.status,
        code,
        init.method === "POST" && response.status >= 500,
      );
    }
    const parsed = schema.safeParse(await json(response));
    if (!parsed.success)
      throw new DependencyError("vela_protocol_error", init.method === "POST");
    return parsed.data;
  }
  return request;
}
