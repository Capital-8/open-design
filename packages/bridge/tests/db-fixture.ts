import { vi } from "vitest";
import type { Db, DbRead } from "../src/index.js";
export function dbFixture() {
  const get = vi.fn(async () => null),
    list = vi.fn(async () => []);
  const reader: DbRead = {
    catalog: {
      officialMetadata: async () => ({}),
      digest: async () => "",
      list: async () => [],
      get: async () => null,
      files: async () => [],
    },
    accounts: { get, byIdentity: get },
    projects: { get, forOwner: list, expiredOperations: list, activity: get },
    conversations: { get, forProject: list, expiredOperations: list },
    runs: {
      get,
      byRequest: get,
      byRemote: get,
      forConversation: list,
      unfinished: list,
    },
    messages: { forConversation: list, userForRun: get },
    events: { after: list, byRuntimeSequence: get },
    outbox: { get },
    browserSessions: { get },
    sessions: { get },
    credentials: { get, authorization: get },
    attachments: {
      get,
      forProject: list,
      usage: async () => ({ count: 0, bytes: "0" }),
    },
    drafts: { forConversation: list },
  };
  const adapter: Db = {
    read: () => reader,
    transaction: async () => {
      throw new Error("unused transaction");
    },
  };
  return {
    adapter,
    reader,
    get,
  };
}
