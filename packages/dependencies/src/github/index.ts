import { z } from "zod";
import { json } from "../internal/http.js";
import { DependencyError } from "../error.js";
export function createGithubClient(fetcher: typeof fetch = fetch) {
  return {
    async stats() {
      try {
        const response = await fetcher(
          "https://api.github.com/repos/nexu-io/open-design",
          {
            headers: {
              accept: "application/vnd.github+json",
              "user-agent": "open-design-cloud",
            },
            redirect: "error",
            signal: AbortSignal.timeout(4000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error();
        }
        return z
          .object({
            full_name: z.literal("nexu-io/open-design"),
            stargazers_count: z.number().int().nonnegative(),
          })
          .parse(await json(response, 65536));
      } catch {
        throw new DependencyError("github_unavailable");
      }
    },
  };
}
