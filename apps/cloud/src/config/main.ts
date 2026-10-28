import { isAbsolute, join } from "node:path";
import type { CredentialKeyring } from "@open-design/adapters/auth";
export function mainConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error("Missing " + name);
    return value;
  };
  const privateHttp = env.OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP ?? "false";
  if (!["true", "false"].includes(privateHttp))
    throw new Error("Invalid OD_CLOUD_RENDERER_ALLOW_PRIVATE_HTTP");
  const url = (name: string) => {
    const value = required(name),
      u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error("Invalid " + name);
    if (
      u.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      !(
        name === "OD_CLOUD_RENDERER_URL" &&
        privateHttp === "true" &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.svc(?:\.cluster\.local)?$/.test(
          u.hostname,
        )
      )
    )
      throw new Error("HTTPS required for " + name);
    return value.replace(/\/$/, "");
  };
  const profile = required("OD_CLOUD_PROFILE");
  if (profile !== "test" && profile !== "prod")
    throw new Error("Invalid OD_CLOUD_PROFILE");
  const raw: unknown = JSON.parse(required("OD_CLOUD_CREDENTIAL_KEYS"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid credential keyring");
  const keys: Record<string, Uint8Array> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value))
      throw new Error("Invalid credential key");
    keys[id] = Buffer.from(value, "base64");
  }
  const active = required("OD_CLOUD_CREDENTIAL_KEY_ID");
  if (!keys[active] || Object.values(keys).some((v) => v.length !== 32))
    throw new Error("Invalid active credential key");
  const root = required("OD_CLOUD_RESOURCE_DIR");
  if (!isAbsolute(root))
    throw new Error("OD_CLOUD_RESOURCE_DIR must be absolute");
  const port = Number(env.OD_CLOUD_PORT ?? 19000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid OD_CLOUD_PORT");
  const webUrl = url("OD_CLOUD_WEB_URL"),
    recovery = env.OD_CLOUD_RUNTIME_RECOVERY ?? "false";
  if (!["true", "false"].includes(recovery))
    throw new Error("Invalid OD_CLOUD_RUNTIME_RECOVERY");
  return {
    profile: profile as "test" | "prod",
    environment: profile,
    host: env.OD_CLOUD_HOST ?? "127.0.0.1",
    port,
    databaseUrl: required("OD_CLOUD_DATABASE_URL"),
    keyring: { active, keys } satisfies CredentialKeyring,
    webUrl,
    secureCookies: new URL(webUrl).protocol === "https:",
    velaApiUrl: url("OD_CLOUD_VELA_API_URL"),
    velaWebUrl: url("OD_CLOUD_VELA_WEB_URL"),
    amrUrl: url("OD_CLOUD_AMR_URL"),
    rendererUrl: url("OD_CLOUD_RENDERER_URL"),
    modelId: env.OD_CLOUD_MODEL_ID ?? null,
    runtimeId: env.OD_CLOUD_RUNTIME_ID ?? "amr",
    supportsRecovery: recovery === "true",
    resourceRoot: join(root, "resources"),
    catalogFile: join(root, "catalog.sqlite"),
    manifest: join(root, "resources", "manifest.json"),
    officialMeta: join(root, "official-resource-meta.json"),
  };
}
export type MainConfig = ReturnType<typeof mainConfig>;
