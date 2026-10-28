import { expect, it } from "vitest";
import { rendererConfig } from "../src/config/renderer.js";
import { mainConfig } from "../src/config/main.js";
it("renderer config requires no database or provider secrets", () => {
  expect(
    rendererConfig({
      OD_CLOUD_CHROMIUM_PATH: "/usr/bin/chromium",
      OD_CLOUD_FFMPEG_PATH: "/usr/bin/ffmpeg",
    }),
  ).toMatchObject({ port: 19001 });
  expect(() =>
    rendererConfig({
      OD_CLOUD_CHROMIUM_PATH: "relative",
      OD_CLOUD_FFMPEG_PATH: "/ffmpeg",
    }),
  ).toThrow();
});
it("main rejects missing persistent keys and non-HTTPS upstream origins", () => {
  const env = {
    OD_CLOUD_PROFILE: "test",
    OD_CLOUD_CREDENTIAL_KEY_ID: "v1",
    OD_CLOUD_CREDENTIAL_KEYS: JSON.stringify({
      v1: Buffer.alloc(32, 1).toString("base64"),
    }),
    OD_CLOUD_DATABASE_URL: "postgres://test",
    OD_CLOUD_RESOURCE_DIR: "/resources",
    OD_CLOUD_WEB_URL: "https://app.test",
    OD_CLOUD_VELA_API_URL: "https://api.test",
    OD_CLOUD_VELA_WEB_URL: "https://login.test",
    OD_CLOUD_AMR_URL: "https://amr.test",
    OD_CLOUD_RENDERER_URL: "http://127.0.0.1:19001",
  };
  expect(mainConfig(env).secureCookies).toBe(true);
  const internal = {
    ...env,
    OD_CLOUD_RENDERER_URL: "http://renderer.od-amr-4114.svc:19001",
  };
  expect(() => mainConfig(internal)).toThrow("HTTPS required");
  expect(
    mainConfig({ ...internal, OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP: "true" })
      .rendererUrl,
  ).toBe(internal.OD_CLOUD_RENDERER_URL);
  for (const override of [
    { OD_CLOUD_RENDERER_URL: "http://public.example.com" },
    { OD_CLOUD_RENDERER_URL: "http://renderer.ns.svc.evil.test" },
    { OD_CLOUD_RENDERER_URL: "http://user:secret@renderer.ns.svc" },
    { OD_CLOUD_AMR_URL: "http://api.ns.svc" },
    { OD_CLOUD_WEB_URL: "http://web.ns.svc" },
    { OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP: "yes" },
  ])
    expect(() =>
      mainConfig({
        ...internal,
        OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP: "true",
        ...override,
      }),
    ).toThrow();
  expect(() =>
    mainConfig({ ...env, OD_CLOUD_CREDENTIAL_KEY_ID: "missing" }),
  ).toThrow();
  expect(() =>
    mainConfig({ ...env, OD_CLOUD_AMR_URL: "http://untrusted.test" }),
  ).toThrow();
});
