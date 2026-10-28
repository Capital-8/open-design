import { z } from "zod";
import { DependencyError } from "../error.js";
import { baseUrl, check, json } from "../internal/http.js";
import {
  createdSchema,
  profileSchema,
  tokenSchema,
  type DeviceAuthorization,
} from "./schemas/auth.js";

export interface DeviceAuthorizationInput {
  cliVersion: string;
  host: string;
  profile: "test" | "prod";
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DependencyError("auth_protocol_error");
  return result.data;
}

/** Raw device-login protocol. No attempts, sessions, polling schedule or stored credentials. */
export function createAmrAuthClient(options: {
  apiUrl: string;
  webUrl: string;
  fetch?: typeof fetch;
}) {
  const apiUrl = baseUrl(options.apiUrl),
    webUrl = baseUrl(options.webUrl);
  const fetcher = options.fetch ?? fetch;
  async function upstream(path: string, init: RequestInit = {}) {
    try {
      const response = await fetcher(apiUrl + path, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      await check(response);
      return await json(response);
    } catch (error) {
      if (error instanceof DependencyError) throw error;
      throw new DependencyError("auth_unavailable");
    }
  }
  return {
    async getProfile(controlKey: string) {
      return parse(
        profileSchema,
        await upstream("/api/v1/me", {
          headers: { Authorization: "Bearer " + controlKey },
        }),
      );
    },
    async createDeviceAuthorization(input: DeviceAuthorizationInput) {
      return parse(
        createdSchema,
        await upstream("/api/v1/cli/device-authorizations", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async pollDeviceAuthorization(deviceId: string, deviceSecret: string) {
      return parse(
        tokenSchema,
        await upstream(
          "/api/v1/cli/device-authorizations/" +
            encodeURIComponent(deviceId) +
            "/token",
          {
            method: "POST",
            body: JSON.stringify({ deviceSecret }),
          },
        ),
      );
    },
    // Separate from creation so the adapter can honor a cancellation before validating the activation URL.
    validateActivation(data: DeviceAuthorization): void {
      const expected = new URL(webUrl + "/cli/activate"),
        activation = new URL(data.activationUrl);
      if (
        activation.origin !== expected.origin ||
        activation.pathname !== expected.pathname ||
        activation.username ||
        activation.password ||
        activation.hash ||
        activation.searchParams.get("deviceId") !== data.deviceId ||
        activation.searchParams.get("userCode") !== data.userCode
      )
        throw new DependencyError("auth_protocol_error");
    },
  };
}
