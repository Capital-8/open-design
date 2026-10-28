import { PublicMetadataCache } from "@open-design/biz/public-metadata";
import { createGithubClient } from "@open-design/dependencies/github";
export function createPublicMetadata(
  client = createGithubClient(),
  cache = new PublicMetadataCache(),
) {
  let pending: Promise<ReturnType<PublicMetadataCache["success"]>> | undefined;
  return {
    async github() {
      const current = cache.current();
      if (current) return current;
      if (pending) return pending;
      pending = client.stats().then(
        (value) => cache.success(value),
        () => cache.failure(),
      );
      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },
  };
}
