import { z } from "zod";
import { DependencyError } from "../../error.js";
import { baseUrl, check, json } from "../../internal/http.js";
import type { AmrAuthorization, AmrRuntimeClientOptions } from "../types.js";
export const projectPath = (id: string) =>
  "/v1/projects/" + encodeURIComponent(id);
export function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  uncertain: boolean,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new DependencyError("runtime_protocol_error", uncertain);
  return result.data;
}
/** Runtime grants are supplied per call; this transport owns no identity or cache. */
export function createRuntimeHttp(options: AmrRuntimeClientOptions) {
  const url = baseUrl(options.runtimeUrl),
    fetcher = options.fetch ?? fetch;
  async function response(
    authorize: AmrAuthorization,
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(
      init.method ?? "GET",
    );
    const deadline = AbortSignal.timeout(signal ? 45000 : 20000);
    for (let attempt = 0; attempt < 2; attempt++) {
      // Only an explicit first 401 refreshes authorization. The same request/deadline is replayed once.
      const token = await authorize(attempt > 0);
      let result: Response;
      try {
        result = await fetcher(url + path, {
          ...init,
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
          headers: {
            "Content-Type": "application/json",
            ...init.headers,
            Authorization: "Bearer " + token,
          },
        });
      } catch {
        throw new DependencyError("runtime_unavailable", mutation);
      }
      if (result.status === 401 && attempt === 0) {
        await result.body?.cancel();
        continue;
      }
      await check(result, mutation);
      return result;
    }
    throw new DependencyError("runtime_unauthorized");
  }
  async function request(
    authorize: AmrAuthorization,
    path: string,
    method = "GET",
    body?: unknown,
  ) {
    const result = await response(authorize, path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try {
      return await json(result);
    } catch {
      throw new DependencyError("runtime_protocol_error", method !== "GET");
    }
  }
  return { request, response };
}
