import { z } from "zod";
export const CONTRACT_VERSION = "0.2.0";
const id = z.string().uuid();
const cursor = z.string().regex(/^(0|[1-9]\d*)$/);
const date = z.string();
export const resourceState = z.enum([
  "provisioning",
  "ready",
  "creation_unknown",
  "failed",
]);
export const runState = z.enum([
  "pending",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
]);
export const fileState = z.enum(["saved", "unknown", "not_attested"]);
export const problem = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  retryable: z.boolean(),
});
export const createProject = z
  .object({ name: z.string().trim().min(1).max(256) })
  .strict();
export const submitRun = z
  .object({
    clientRequestId: z.string().min(1).max(128),
    input: z.string().min(1),
  })
  .strict();
export const saveHtml = z
  .object({ html: z.string(), expected: z.string() })
  .strict();
export const project = z.object({
  id,
  name: z.string(),
  creationStatus: resourceState,
  creationError: z.string().nullable(),
  activeRunId: id.nullable(),
  editState: z.enum(["idle", "editing", "unknown"]),
  createdAt: date,
});
export const conversation = z.object({
  id,
  projectId: id,
  creationStatus: resourceState,
  creationError: z.string().nullable(),
  createdAt: date,
});
export const run = z.object({
  id,
  conversationId: id,
  clientRequestId: z.string(),
  status: runState,
  submission: z.enum(["pending", "confirmed", "unconfirmed", "rejected"]),
  cancelRequested: z.boolean(),
  cancelConfirmed: z.boolean(),
  files: fileState,
  cleanup: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: date,
});
export const call = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});
export const message = z.object({
  id,
  conversationId: id,
  runId: id,
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),
  complete: z.boolean(),
  turn: z.string().nullable(),
  calls: z.array(call).nullable(),
  toolCallId: z.string().nullable(),
  createdAt: date,
});
export const snapshot = z.object({
  project,
  conversation,
  messages: z.array(message),
  runs: z.array(run),
  cursor,
});
export const content = z.object({
  path: z.literal("index.html"),
  html: z.string(),
  version: z.string(),
});
export const directory = z.object({
  files: z.array(
    z.object({ path: z.string(), kind: z.string(), size: z.string() }),
  ),
  cursor: z.string(),
});
export const delta = z.object({
  turn: z.string().optional(),
  text: z.string().optional(),
  calls: z
    .array(
      z.object({
        index: z.number().int(),
        id: z.string().optional(),
        name: z.string().optional(),
        arguments: z.string().optional(),
      }),
    )
    .optional(),
});
export const eventPayload = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message.start"),
    runId: id,
    turn: z.string().optional(),
  }),
  z.object({ kind: z.literal("message.delta"), runId: id, delta }),
  z.object({ kind: z.literal("message.complete"), runId: id, message }),
  z.object({
    kind: z.literal("message.abort"),
    runId: id,
    turn: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool.state"),
    runId: id,
    call: call.optional(),
    execution: z.string().optional(),
    status: z.string().optional(),
  }),
  z.object({ kind: z.literal("run.updated"), run }),
  z.object({ kind: z.literal("snapshot.updated") }),
]);
export const event = z.object({
  sequence: cursor,
  conversationId: id,
  time: date,
  payload: eventPayload,
});
export const me = z.object({
  session: z.object({ expiresAt: z.string() }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    image: z.string().nullable(),
    status: z.string(),
  }),
});
export const authProviders = z.object({
  providers: z.array(z.enum(["email", "google", "github"])),
  emailPasswordOnly: z.boolean().default(false),
  vela: z
    .object({ profile: z.enum(["test", "prod"]), webUrl: z.string().url() })
    .optional(),
  turnstile: z.object({ enabled: z.boolean(), siteKey: z.string().optional() }),
});
export const deviceLogin = z.object({
  activationUrl: z.string().url(),
  userCode: z.string().min(1),
  expiresAt: z.string().datetime(),
  pollIntervalSeconds: z.number().int().min(1).max(30),
});
export const deviceLoginStatus = z.object({
  status: z.enum(["pending", "approved", "cancelled", "expired", "consumed"]),
});
export const schemas = {
  problem,
  createProject,
  submitRun,
  saveHtml,
  project,
  conversation,
  run,
  message,
  snapshot,
  content,
  directory,
  event,
  me,
  authProviders,
  deviceLogin,
  deviceLoginStatus,
};
export type Project = z.infer<typeof project>;
export type Conversation = z.infer<typeof conversation>;
export type Run = z.infer<typeof run>;
export type Message = z.infer<typeof message>;
export type EventPayload = z.infer<typeof eventPayload>;
export type BusinessEvent = z.infer<typeof event>;
export const routes = [
  ["GET", "/api/auth/providers"],
  ["ALL", "/api/auth/*"],
  ["GET", "/api/me"],
  ["GET", "/api/projects"],
  ["POST", "/api/projects"],
  ["GET", "/api/projects/:id/conversations"],
  ["POST", "/api/projects/:id/conversations"],
  ["GET", "/api/conversations/:id"],
  ["POST", "/api/conversations/:id/runs"],
  ["GET", "/api/runs/:id"],
  ["POST", "/api/runs/:id/cancel"],
  ["GET", "/api/conversations/:id/events"],
  ["GET", "/api/projects/:id/directory"],
  ["GET", "/api/projects/:id/files/index.html"],
  ["PUT", "/api/projects/:id/files/index.html"],
  ["GET", "/api/projects/:id/files/index.html/download"],
  ["GET", "/api/billing/summary"],
] as const;
