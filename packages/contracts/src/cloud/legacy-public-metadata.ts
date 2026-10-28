import { z } from "zod";

// Original client's /api/github/open-design response.
export const githubRepoStats = z.object({
  repo: z.literal("nexu-io/open-design"),
  stargazers_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fetchedAt: z.number().int().nonnegative(),
  stale: z.boolean(),
});
export type GithubRepoStats = z.infer<typeof githubRepoStats>;
