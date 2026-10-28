import { BizError } from "../errors.js";
export class PublicMetadataCache {
  private value:
    | {
        repo: string;
        stargazers_count: number;
        fetchedAt: number;
        stale: boolean;
      }
    | undefined;
  private retryAt = 0;
  constructor(private readonly now = Date.now) {}
  current() {
    if (this.value && this.now() - this.value.fetchedAt < 3600000)
      return { ...this.value };
    if (this.now() < this.retryAt) return this.fallback();
    return undefined;
  }
  success(facts: { full_name: string; stargazers_count: number }) {
    if (
      facts.full_name !== "nexu-io/open-design" ||
      !Number.isSafeInteger(facts.stargazers_count) ||
      facts.stargazers_count < 0
    )
      throw new BizError("github_unavailable");
    this.value = {
      repo: facts.full_name,
      stargazers_count: facts.stargazers_count,
      fetchedAt: this.now(),
      stale: false,
    };
    this.retryAt = 0;
    return { ...this.value };
  }
  failure() {
    this.retryAt = this.now() + 60000;
    return this.fallback();
  }
  private fallback() {
    if (this.value) return { ...this.value, stale: true };
    throw new BizError(
      "github_unavailable",
      "暂时无法获取 GitHub Star 数据，请稍后重试",
      true,
    );
  }
}
