import { expect, it } from "vitest";
import { PublicMetadataCache } from "../src/public-metadata/index.js";
it("retains a stale public snapshot during outages and does not invent a zero count", () => {
  let time = 0;
  const cache = new PublicMetadataCache(() => time);
  expect(cache.current()).toBeUndefined();
  expect(() => cache.failure()).toThrow();
  expect(() => cache.current()).toThrow();
  time = 60001;
  expect(cache.current()).toBeUndefined();
  expect(
    cache.success({ full_name: "nexu-io/open-design", stargazers_count: 10 }),
  ).toMatchObject({ stale: false });
  time += 3600001;
  expect(cache.failure()).toMatchObject({ stargazers_count: 10, stale: true });
  expect(cache.current()).toMatchObject({ stale: true });
});
