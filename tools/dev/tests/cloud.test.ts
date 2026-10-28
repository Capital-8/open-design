import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudStamp } from "../src/cloud.js";
import { rewriteCliArgsForDefaultStart } from "../src/cli-args.js";
test("cloud lifecycle gets distinct five-field identities and uses the explicit command", () => {
  const main = cloudStamp("test-cloud", "cloud"),
    renderer = cloudStamp("test-cloud", "cloud-renderer");
  assert.equal(Object.keys(main).length, 5);
  assert.notDeepEqual(main, renderer);
  assert.deepEqual(rewriteCliArgsForDefaultStart(["cloud", "status"]), [
    "cloud",
    "status",
  ]);
  assert.throws(() => cloudStamp("../escape", "cloud"));
});
