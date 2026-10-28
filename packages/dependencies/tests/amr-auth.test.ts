import { describe, expect, it, vi } from "vitest";
import {
  createAmrAuthClient,
  createAmrAuthorizationClient,
} from "../src/amr/index.js";
import { DependencyError } from "../src/index.js";

const profile = {
  id: "provider-id",
  authUserId: "auth-id",
  email: "test@example.com",
  name: null,
  status: "banned",
};
const created = {
  deviceId: "device /?",
  deviceSecret: "test-secret",
  userCode: "CODE",
  activationUrl:
    "https://login.example/base/cli/activate?deviceId=device+%2F%3F&userCode=CODE",
  expiresAt: "2026-10-27T00:01:00Z",
  pollIntervalSeconds: 1,
};

describe("AMR account protocols without application login state", () => {
  it("returns provider identity fields and status without making account policy decisions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(profile));
    const client = createAmrAuthClient({
      apiUrl: "https://vela.example/base",
      webUrl: "https://login.example/base",
      fetch: fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.getProfile("test-key")).toEqual(profile);
    expect(fetcher.mock.calls[0]).toEqual([
      "https://vela.example/base/api/v1/me",
      expect.objectContaining({
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
      }),
    ]);
  });

  it("performs each device protocol call explicitly without scheduling or storing secrets", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(created))
      .mockResolvedValueOnce(Response.json({ status: "pending" }))
      .mockResolvedValueOnce(Response.json({ status: "consumed" }));
    const client = createAmrAuthClient({
      apiUrl: "https://vela.example",
      webUrl: "https://login.example/base",
      fetch: fetcher,
    });
    expect(
      await client.createDeviceAuthorization({
        cliVersion: "test",
        host: "host",
        profile: "test",
      }),
    ).toEqual(created);
    client.validateActivation(created);
    expect(
      await client.pollDeviceAuthorization(created.deviceId, "first-secret"),
    ).toEqual({ status: "pending" });
    expect(
      await client.pollDeviceAuthorization(created.deviceId, "second-secret"),
    ).toEqual({ status: "consumed" });
    expect(fetcher.mock.calls[1]![0]).toBe(
      "https://vela.example/api/v1/cli/device-authorizations/device%20%2F%3F/token",
    );
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body))).toEqual({
      deviceSecret: "second-secret",
    });
    expect(() =>
      client.validateActivation({
        ...created,
        activationUrl: "https://wrong.example/cli/activate",
      }),
    ).toThrow(DependencyError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("validates provider DTOs without returning raw parsing errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...profile, status: "new-unknown-status" }),
      );
    const client = createAmrAuthClient({
      apiUrl: "https://vela.example",
      webUrl: "https://login.example",
      fetch: fetcher,
    });
    await expect(client.getProfile("key")).rejects.toMatchObject({
      name: "DependencyError",
      code: "auth_protocol_error",
    });
  });

  it("returns a grant as a protocol fact; scope binding and expiry policy stay with its caller", async () => {
    const grant = {
      token: "od_grant_test",
      actor: "upstream-actor",
      workspace: "returned-workspace",
      expires: "2026-01-01T00:00:00Z",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(grant));
    const client = createAmrAuthorizationClient({
      apiUrl: "https://vela.example",
      fetch: fetcher,
    });
    expect(await client.authorize("test-key", "requested-workspace")).toEqual(
      grant,
    );
    expect(fetcher.mock.calls[0]![0]).toBe(
      "https://vela.example/api/v1/harness/authorizations",
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer test-key" },
      body: JSON.stringify({ workspace: "requested-workspace" }),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
