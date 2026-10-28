import { once } from "node:events";
import type { Response } from "express";

export async function writeStream(
  res: Response,
  signal: AbortSignal,
  chunk: string,
) {
  signal.throwIfAborted();
  if (!res.write(chunk)) await once(res, "drain", { signal });
}

export async function writeEvent(
  res: Response,
  signal: AbortSignal,
  event: string,
  data: unknown,
  id?: string,
) {
  await writeStream(
    res,
    signal,
    `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}
