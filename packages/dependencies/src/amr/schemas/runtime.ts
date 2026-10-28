import { z } from "zod";

const id = z.string().min(1);
export const runSchema = z.object({
  id,
  project: id,
  session: id,
  status: id,
  answer: z.string(),
  detail: z.string(),
  key: id,
  created: z.string().datetime({ offset: true }),
});
const objectSchema = z.record(z.unknown());
export const snapshotSchema = z.object({
  session: z.object({ id, project: id }),
  cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  messages: z.array(objectSchema).default([]),
  runs: z.array(runSchema).default([]),
  previews: z.array(objectSchema).default([]),
});
export const eventSchema = z.object({
  run: id,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  time: z.string().datetime({ offset: true }),
  signal: z.object({ kind: id }).passthrough(),
});

export type AmrRun = z.infer<typeof runSchema>;
export type AmrSnapshot = z.infer<typeof snapshotSchema>;
export type AmrEvent = z.infer<typeof eventSchema>;
