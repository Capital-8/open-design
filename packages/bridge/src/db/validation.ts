import type { DbRead } from "../db.js";
const methods = {
  catalog: ["officialMetadata", "digest", "list", "get", "files"],
  accounts: ["get", "byIdentity"],
  projects: ["get", "forOwner", "expiredOperations", "activity"],
  conversations: ["get", "forProject", "expiredOperations"],
  runs: ["get", "byRequest", "byRemote", "forConversation", "unfinished"],
  messages: ["forConversation", "userForRun"],
  events: ["after", "byRuntimeSequence"],
  outbox: ["get"],
  browserSessions: ["get"],
  sessions: ["get"],
  credentials: ["get", "authorization"],
  attachments: ["get", "forProject", "usage"],
  drafts: ["forConversation"],
} as const satisfies { [K in keyof DbRead]: readonly (keyof DbRead[K])[] };
export function captureDbRead(value: unknown): DbRead {
  const out: Record<string, unknown> = {};
  for (const [name, names] of Object.entries(methods)) {
    const source =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[name]
        : undefined;
    const bound: Record<string, unknown> = {};
    for (const method of names) {
      const operation =
        source && typeof source === "object"
          ? (source as Record<string, unknown>)[method]
          : undefined;
      if (typeof operation !== "function")
        throw new TypeError(`Bridge requires db.read().${name}.${method}()`);
      bound[method] = operation.bind(source);
    }
    out[name] = Object.freeze(bound);
  }
  return Object.freeze(out) as unknown as DbRead;
}
