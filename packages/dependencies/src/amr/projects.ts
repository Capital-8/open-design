import { z } from "zod";
import { DependencyError } from "../error.js";
import {
  createRuntimeHttp,
  parse,
  projectPath,
} from "./internal/runtime-http.js";
import type { AmrAuthorization, AmrRuntimeClientOptions } from "./types.js";
/** Remote project/session protocol only; creation workflows belong to biz. */
export function createAmrProjectClient(options: AmrRuntimeClientOptions) {
  const { request } = createRuntimeHttp(options);
  return {
    async createProject(authorize: AmrAuthorization, name: string) {
      await request(authorize, "/v1/me");
      return parse(
        z.object({ id: z.string().min(1) }),
        await request(authorize, "/v1/projects", "POST", { name }),
        true,
      );
    },
    async createSession(authorize: AmrAuthorization, project: string) {
      const value = parse(
        z.object({ id: z.string().min(1), project: z.string().min(1) }),
        await request(authorize, projectPath(project) + "/sessions", "POST"),
        true,
      );
      if (value.project !== project)
        throw new DependencyError("runtime_protocol_error", true);
      return value;
    },
  };
}
