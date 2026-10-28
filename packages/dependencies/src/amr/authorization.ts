import { z } from "zod";
import { DependencyError } from "../error.js";
import { baseUrl, check, json } from "../internal/http.js";

const grantSchema = z.object({
  token: z.string().regex(/^od_grant_[A-Za-z0-9_-]+$/),
  actor: z.string().min(1),
  workspace: z.string().min(1),
  expires: z.string().datetime({ offset: true }),
});
export type AmrGrant = z.infer<typeof grantSchema>;

/** One protocol request per invocation. Scope binding, expiry policy and caching belong to the adapter. */
export function createAmrAuthorizationClient(options: {
  apiUrl: string;
  fetch?: typeof fetch;
}) {
  const apiUrl = baseUrl(options.apiUrl),
    fetcher = options.fetch ?? fetch;
  return {
    async authorize(controlKey: string, workspace: string): Promise<AmrGrant> {
      let response: Response;
      try {
        response = await fetcher(apiUrl + "/api/v1/harness/authorizations", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + controlKey,
          },
          body: JSON.stringify({ workspace }),
        });
      } catch {
        throw new DependencyError("runtime_authorization_unavailable");
      }
      await check(response);
      const parsed = grantSchema.safeParse(await json(response));
      if (!parsed.success)
        throw new DependencyError("runtime_authorization_invalid");
      return parsed.data;
    },
  };
}
