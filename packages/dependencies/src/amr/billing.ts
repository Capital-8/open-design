import {
  balanceSchema,
  snapshotSchema,
  preflightSchema,
  summarySchema,
} from "./schemas/billing.js";
import {
  createApiRequest,
  workspacePath as workspace,
} from "./internal/api-http.js";
import type { AmrApiClientOptions } from "./types.js";
export function createAmrBillingClient<Context>(
  options: AmrApiClientOptions<Context>,
) {
  const request = createApiRequest(options);
  return {
    snapshot: (context: Context, id: string) =>
      request(context, workspace(id) + "/billing/snapshot", snapshotSchema),
    balance: (context: Context, id: string) =>
      request(context, workspace(id) + "/wallet/balance", balanceSchema),
    preflight: (context: Context, id: string, modelId: string | null) =>
      request(
        context,
        workspace(id) +
          "/billing/preflight" +
          (modelId ? "?" + new URLSearchParams({ modelId }) : ""),
        preflightSchema,
      ),
    summary: (context: Context) =>
      request(context, "/api/v1/billing/summary", summarySchema),
  };
}
