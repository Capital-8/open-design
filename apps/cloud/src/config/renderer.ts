import { isAbsolute } from "node:path";
export function rendererConfig(env: NodeJS.ProcessEnv = process.env) {
  const executable = (key: string) => {
    const value = env[key];
    if (!value || !isAbsolute(value))
      throw new Error(key + " must be an absolute executable path");
    return value;
  };
  const port = Number(env.OD_CLOUD_RENDERER_PORT ?? 19001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid OD_CLOUD_RENDERER_PORT");
  return {
    host: env.OD_CLOUD_RENDERER_HOST ?? "127.0.0.1",
    port,
    executablePath: executable("OD_CLOUD_CHROMIUM_PATH"),
    ffmpegPath: executable("OD_CLOUD_FFMPEG_PATH"),
  };
}
