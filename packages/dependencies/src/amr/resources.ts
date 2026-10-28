import { z } from "zod";
import { createRuntimeHttp, parse } from "./internal/runtime-http.js";
import type { AmrAuthorization, AmrRuntimeClientOptions } from "./types.js";
export function createAmrResourceClient(options: AmrRuntimeClientOptions) {
  const { request } = createRuntimeHttp(options);
  return {
    async officialResources(authorize: AmrAuthorization) {
      return parse(
        z.object({
          version: z.literal(1),
          maxSelections: z.number().int().nonnegative(),
          resources: z.array(
            z.object({
              type: z.enum(["plugin", "skill", "design-system"]),
              id: z.string().min(1),
            }),
          ),
        }),
        await request(authorize, "/v1/official-resources"),
        false,
      );
    },
  };
}
