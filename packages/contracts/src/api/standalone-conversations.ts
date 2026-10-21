import type { Conversation } from './projects.js';
import type { ChatRunStatus, ChatSessionMode } from './chat.js';

/** A persisted conversation with its own workspace, without a project relationship. */
export interface StandaloneConversation extends Omit<Conversation, 'projectId'> {
  projectId: null;
  /** Latest execution state; omitted when the conversation has never run. */
  runStatus?: ChatRunStatus;
}
export interface CreateStandaloneConversationRequest {
  title?: string | null;
  sessionMode?: ChatSessionMode;
}
export type UpdateStandaloneConversationRequest = CreateStandaloneConversationRequest;
export interface StandaloneConversationResponse { conversation: StandaloneConversation }
export interface StandaloneConversationsResponse { conversations: StandaloneConversation[] }

/** Expiring bearer URL, scoped to one conversation's files and rechecked on reads. */
export interface StandaloneConversationPreviewScopeResponse {
  baseUrl: string;
  expiresAt: number;
}
