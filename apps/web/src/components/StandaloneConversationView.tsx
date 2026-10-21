import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button, Dialog, DialogFooter, DialogTitle, Input } from '@open-design/components';
import type { ByokChatProviderConfig, ByokChatProtocol, ChatSessionMode, StandaloneConversation, WorkspaceCollabContext } from '@open-design/contracts';
import type { ChatAttachment, ChatCommentAttachment, ChatMessage, ProjectFile } from '../types';
import { useI18n, useT } from '../i18n';
import { currentWorkspaceAccountGeneration, workspaceIdentityCacheKey } from '../collab/workspace-identity';
import { reattachDaemonRun, streamViaDaemon, type DaemonStreamHandlers } from '../providers/daemon';
import {
  deleteStandaloneConversation, getStandaloneConversation, listStandaloneActiveRuns,
  listStandaloneFiles, listStandaloneMessages, notifyStandaloneConversationsChanged,
  renameStandaloneConversation, standaloneFileUrl, standaloneFilePreviewUrl, getStandaloneFilePreviewScope, updateStandaloneConversation, uploadStandaloneFiles,
} from '../state/standalone-conversations';
import { strategySettledMessageFields, strategyTaskRunIndex } from '../runtime/strategy-question-continuation';
import { effectiveAgentModelChoice } from './agentModelSelection';
import { AvatarMenu } from './AvatarMenu';
import { ChatPane } from './ChatPane';
import type { ChatSendMeta, ChatSendOutcome } from './ChatComposer';
import { Icon } from './Icon';
import styles from './StandaloneConversationView.module.css';

export interface StandaloneConversationViewProps extends Pick<ComponentProps<typeof AvatarMenu>,
  'config' | 'agents' | 'daemonLive' | 'onModeChange' | 'onAgentChange' | 'onAgentModelChange' | 'onApiModelChange' | 'onRefreshAgents' | 'onOpenSettings'> {
  conversationId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  onBack?: () => void;
  onDeleted?: () => void;
  onTitleChange?: (title: string) => void;
}

/** A real conversation host: no Project record or project-shaped storage alias. */
export function StandaloneConversationView({ conversationId, workspaceContext = null, onBack, onDeleted,
  onTitleChange, ...execution }: StandaloneConversationViewProps) {
  const t = useT(); const { locale } = useI18n();
  const [conversation, setConversation] = useState<StandaloneConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewState, setPreviewState] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const lifetime = useRef(0);
  const subscription = useRef<AbortController | null>(null);
  const cancellation = useRef<AbortController | null>(null);
  const titleCallback = useRef(onTitleChange); titleCallback.current = onTitleChange;
  const identity = `${currentWorkspaceAccountGeneration()}:${workspaceIdentityCacheKey(workspaceContext)}`;
  const title = conversation?.title || t('chat.untitledConversation');
  const mode = conversation?.sessionMode ?? 'chat';
  const previewKey = `${identity}:${conversationId}:${preview ?? ''}`;
  const currentPreview = previewState?.key === previewKey ? previewState : null;

  useEffect(() => {
    if (!preview) { setPreviewState(null); return; }
    const controller = new AbortController();
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    setPreviewState({ key: previewKey });
    void getStandaloneFilePreviewScope(conversationId, workspaceContext, controller.signal).then((scope) => {
      if (controller.signal.aborted) return;
      setPreviewState({ key: previewKey, url: standaloneFilePreviewUrl(scope.baseUrl, preview) });
      // The URL is a short-lived capability. A continuously open preview gets a
      // fresh scope when it expires; reopening always requests one as well.
      expiryTimer = setTimeout(() => setPreviewAttempt((attempt) => attempt + 1), Math.max(1000, scope.expiresAt - Date.now() + 100));
    }).catch((failure) => {
      if (!controller.signal.aborted) setPreviewState({ key: previewKey, error: failure instanceof Error ? failure.message : String(failure) });
    });
    return () => { controller.abort(); clearTimeout(expiryTimer); };
  }, [conversationId, identity, preview, previewAttempt]);


  const mutateMessages = (update: (rows: ChatMessage[]) => ChatMessage[]) => {
    const next = update(messagesRef.current); messagesRef.current = next; setMessages(next);
  };
  const updateAssistant = (id: string, update: Partial<ChatMessage>) => {
    mutateMessages((rows) => rows.map((row) => row.id === id ? { ...row, ...update } : row));
  };
  const refresh = async (generation: number, signal?: AbortSignal) => {
    const [row, history, artifacts] = await Promise.all([
      getStandaloneConversation(conversationId, workspaceContext, signal),
      listStandaloneMessages(conversationId, workspaceContext, signal),
      listStandaloneFiles(conversationId, workspaceContext, signal),
    ]);
    if (lifetime.current !== generation || signal?.aborted) return;
    setConversation(row); messagesRef.current = history; setMessages(history); setFiles(artifacts);
    titleCallback.current?.(row.title || t('chat.untitledConversation'));
    notifyStandaloneConversationsChanged();
  };

  function attachHandlers(id: string, generation: number, controller: AbortController, contentPrefix = ''): DaemonStreamHandlers {
    const owns = () => lifetime.current === generation && !controller.signal.aborted;
    const finish = () => {
      if (!owns()) return;
      // Keep sending locked until persisted history has replaced the streamed
      // turn, otherwise a late refresh can erase the next optimistic turn.
      void refresh(generation, controller.signal).catch((failure) => {
        if (owns()) setError(failure instanceof Error ? failure.message : String(failure));
      }).finally(() => {
        if (owns()) { streamingRef.current = false; setStreaming(false); }
      });
    };
    return {
      onDelta: (delta) => {
        if (!owns()) return;
        mutateMessages((rows) => rows.map((row) => row.id === id ? { ...row, content: row.content + delta } : row));
      },
      onAgentEvent: (event) => {
        if (!owns()) return;
        if (event.kind === 'conversation_title') {
          setConversation((row) => row ? { ...row, title: event.title } : row);
          titleCallback.current?.(event.title); notifyStandaloneConversationsChanged();
        }
        mutateMessages((rows) => rows.map((row) => row.id === id ? { ...row, events: [...(row.events ?? []), event] } : row));
      },
      onDone: (content) => { if (owns()) updateAssistant(id, { content: contentPrefix + content, endedAt: Date.now() }); finish(); },
      onError: (failure) => { if (owns()) setError(failure.message); finish(); },
    };
  }

  useEffect(() => {
    const generation = ++lifetime.current;
    const controller = new AbortController(); subscription.current = controller;
    setLoading(true); setLoadFailed(false); setError(null); setConversation(null); setFiles([]);
    setDialog(null); setSaving(false); setPreview(null);
    messagesRef.current = []; setMessages([]); streamingRef.current = false; setStreaming(false);
    void (async () => {
      try {
        await refresh(generation, controller.signal);
        const runs = await listStandaloneActiveRuns(conversationId, workspaceContext, controller.signal);
        if (controller.signal.aborted || lifetime.current !== generation) return;
        setLoading(false);
        const run = runs[0];
        const assistantId = run?.assistantMessageId;
        if (!run || !assistantId) return;
        if (!messagesRef.current.some((message) => message.id === assistantId)) {
          mutateMessages((rows) => [...rows, { id: assistantId, role: 'assistant', content: '', runId: run.id, runStatus: run.status, agentId: run.agentId ?? undefined }]);
        }
        const restored = messagesRef.current.find((message) => message.id === assistantId);
        const cursor = restored?.lastRunEventId;
        // No cursor means the daemon replays the complete event log. Replace the
        // stored partial turn before replay, rather than appending it twice.
        if (!cursor) updateAssistant(assistantId, { content: '', events: [] });
        const cancel = new AbortController(); cancellation.current = cancel;
        streamingRef.current = true; setStreaming(true);
        await reattachDaemonRun({ runId: run.id, agentId: run.agentId ?? undefined, projectId: null,
          conversationId, workspaceContext, signal: controller.signal, cancelSignal: cancel.signal,
          initialLastEventId: cursor,
          handlers: attachHandlers(assistantId, generation, controller, cursor ? restored?.content : ''),
          onRunStatus: (status) => { if (!controller.signal.aborted) updateAssistant(assistantId, { runStatus: status }); },
          onRunEventId: (lastRunEventId) => { if (!controller.signal.aborted) updateAssistant(assistantId, { lastRunEventId }); },
          onRunCreated: (runId) => { if (!controller.signal.aborted) updateAssistant(assistantId, { runId }); },
          onStrategyTaskSettled: (task) => { if (!controller.signal.aborted) updateAssistant(assistantId, strategySettledMessageFields(task) ?? {}); },
        });
      } catch (failure) {
        if (controller.signal.aborted || lifetime.current !== generation) return;
        setLoading(false); setLoadFailed(true); streamingRef.current = false; setStreaming(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
    return () => { controller.abort(); subscription.current?.abort(); ++lifetime.current; };
    // This lifetime is owned by the actual conversation and workspace identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, identity, reload]);

  async function send(prompt: string, attachments: ChatAttachment[], comments: ChatCommentAttachment[], meta?: ChatSendMeta, taskExecutionId?: string): Promise<ChatSendOutcome> {
    if (loading || loadFailed || streamingRef.current || !conversation) return 'restore-draft';
    const generation = lifetime.current;
    const controller = new AbortController(); subscription.current?.abort(); subscription.current = controller;
    const cancel = new AbortController(); cancellation.current = cancel;
    const { config, agents } = execution;
    const agentId = config.mode === 'api' ? 'byok-opencode' : config.agentId;
    if (!agentId) { setError(t('chat.runError.title.runtimeConfig')); return 'restore-draft'; }
    const choice = effectiveAgentModelChoice(agents.find((agent) => agent.id === agentId), config.agentModels?.[agentId]);
    let byokProvider: ByokChatProviderConfig | undefined;
    if (agentId === 'byok-opencode') {
      const protocols: string[] = ['anthropic', 'openai', 'azure', 'google', 'ollama', 'senseaudio', 'aihubmix'];
      if (!config.apiProtocol || !protocols.includes(config.apiProtocol) || !config.model.trim()) {
        setError(t('chat.runError.title.runtimeConfig')); return 'restore-draft';
      }
      byokProvider = { protocol: config.apiProtocol as ByokChatProtocol, apiKey: config.apiKey,
        baseUrl: config.baseUrl, model: config.model, ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}) };
    }
    const now = Date.now(); const userId = crypto.randomUUID(); const assistantId = crypto.randomUUID();
    const sessionMode = meta?.sessionMode ?? mode;
    const user: ChatMessage = { id: userId, role: 'user', content: prompt, createdAt: now, attachments, commentAttachments: comments, sessionMode };
    const history = [...messagesRef.current, user];
    const assistant: ChatMessage = { id: assistantId, role: 'assistant', content: '', events: [], createdAt: now, startedAt: now, agentId, runStatus: 'queued', sessionMode };
    messagesRef.current = [...history, assistant]; setMessages(messagesRef.current); setError(null);
    streamingRef.current = true; setStreaming(true);
    const owns = () => lifetime.current === generation && !controller.signal.aborted;
    const baseHandlers = attachHandlers(assistantId, generation, controller);
    let accepted = false;
    let acknowledge!: (outcome: ChatSendOutcome) => void;
    const acknowledgement = new Promise<ChatSendOutcome>((resolve) => { acknowledge = resolve; });
    const handlers: DaemonStreamHandlers = { ...baseHandlers,
      onDone: (content) => { acknowledge(); baseHandlers.onDone(content); },
      onError: (failure) => {
        if (!accepted) {
          if (owns()) {
            // A rejected request owns no persisted turn. Return the exact
            // optimistic draft to ChatComposer instead of erasing it on reload.
            mutateMessages((rows) => rows.filter((row) => row.id !== userId && row.id !== assistantId));
            setError(failure.message); streamingRef.current = false; setStreaming(false);
          }
          acknowledge('restore-draft');
        } else baseHandlers.onError(failure);
      },
    };
    void streamViaDaemon({ agentId, history, signal: controller.signal, cancelSignal: cancel.signal, handlers,
      projectId: null, conversationId, workspaceContext, taskExecutionId, userMessageId: userId, assistantMessageId: assistantId,
      clientRequestId: meta?.clientRequestId ?? crypto.randomUUID(), sessionMode, locale,
      model: byokProvider ? config.model : choice?.model, reasoning: choice?.reasoning, serviceTier: choice?.serviceTier,
      byokProvider, attachments: attachments.map((file) => file.path), commentAttachments: comments,
      context: meta?.context, skillIds: meta?.skillIds, research: meta?.research,
      appliedPluginSnapshotId: meta?.appliedPluginSnapshotId ?? meta?.appliedPluginSnapshot?.snapshotId,
      pluginId: meta?.appliedPluginSnapshot?.pluginId, pluginInputs: meta?.appliedPluginSnapshot?.inputs,
      titleGeneration: { enabled: history.length === 1 },
      onRunCreated: (runId, task) => {
        accepted = true; acknowledge();
        if (owns()) updateAssistant(assistantId, { runId,
          ...(task ? { strategyTaskExecutionId: task.taskExecutionId, strategyTaskRunIndex: strategyTaskRunIndex(task, runId) } : {}),
        });
      },
      onRunStatus: (runStatus) => { if (owns()) updateAssistant(assistantId, { runStatus }); },
      onRunEventId: (lastRunEventId) => { if (owns()) updateAssistant(assistantId, { lastRunEventId }); },
      onStrategyTaskSettled: (task) => { if (owns()) updateAssistant(assistantId, strategySettledMessageFields(task) ?? {}); },
    }).catch((failure) => handlers.onError(failure instanceof Error ? failure : new Error(String(failure))))
      .finally(() => {
        // Cancellation during run creation can finish without a stream callback.
        // Always settle the composer's pending submit and retain an unsent draft.
        if (!accepted) {
          if (owns()) {
            mutateMessages((rows) => rows.filter((row) => row.id !== userId && row.id !== assistantId));
            streamingRef.current = false; setStreaming(false);
          }
          acknowledge('restore-draft');
        }
      });
    return acknowledgement;
  }
  const upload = useCallback(async (selected: File[]) => {
    const generation = lifetime.current;
    const result = await uploadStandaloneFiles(conversationId, selected, workspaceContext);
    void listStandaloneFiles(conversationId, workspaceContext).then((rows) => {
      if (lifetime.current === generation) setFiles(rows);
    }).catch((failure) => { if (lifetime.current === generation) setError(String(failure)); });
    return result;
  }, [conversationId, identity]);
  const fileUrl = (path: string) => standaloneFileUrl(conversationId, path, workspaceContext);
  async function saveDialog() {
    if (saving || !conversation) return;
    const generation = lifetime.current;
    setSaving(true); setError(null);
    try {
      if (dialog === 'delete') {
        await deleteStandaloneConversation(conversationId, workspaceContext);
        if (lifetime.current === generation) { setDialog(null); onDeleted?.(); }
      }
      else {
        const row = await renameStandaloneConversation(conversationId, titleDraft.trim(), workspaceContext);
        if (lifetime.current === generation) { setConversation(row); titleCallback.current?.(row.title || t('chat.untitledConversation')); setDialog(null); }
      }
    } catch (failure) { if (lifetime.current === generation) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (lifetime.current === generation) setSaving(false); }
  }
  return <section className={styles.root} data-testid="standalone-conversation-view">
    <header className={styles.header}>
      {onBack ? <Button variant="ghost" size="icon" aria-label={t('settings.onboardingBack')} onClick={onBack}><Icon name="arrow-left" size={18} /></Button> : null}
      <strong>{title}</strong>
      <Button variant="ghost" disabled={!conversation || streaming} onClick={() => { setTitleDraft(conversation?.title ?? ''); setDialog('rename'); }}>{t('common.rename')}</Button>
      <Button variant="ghost" disabled={!conversation || streaming} onClick={() => setDialog('delete')}>{t('common.delete')}</Button>
    </header>
    {loadFailed ? <div className={styles.loadFailure} role="alert"><span>{error}</span><Button onClick={() => setReload((value) => value + 1)}>{t('preview.retry')}</Button></div> : null}
    <div className={styles.body}>
      <div className={styles.chat}>
        <ChatPane key={`${identity}:${conversationId}`} messages={messages} streaming={streaming} loading={loading}
          error={loadFailed ? null : error} projectId={null} projectFiles={files} projectFileNames={new Set(files.map((file) => file.name))}
          activeConversationId={conversationId} messagesConversationId={loading ? null : conversationId} conversations={[]}
          onSelectConversation={() => undefined} onDeleteConversation={() => setDialog('delete')}
          sessionMode={mode} onSessionModeChange={(sessionMode: ChatSessionMode) => {
            const generation = lifetime.current;
            void updateStandaloneConversation(conversationId, { sessionMode }, workspaceContext).then((row) => {
              if (lifetime.current === generation) setConversation(row);
            }).catch((failure) => { if (lifetime.current === generation) setError(String(failure)); });
          }}
          sendDisabled={loading || loadFailed || streaming} viewerOnly={loadFailed}
          onEnsureProject={async () => null} onUploadFiles={upload} attachmentUrl={fileUrl}
          draftStorageKey={`od:standalone-composer:${identity}:${conversationId}`}
          onSend={send} onStop={() => cancellation.current?.abort()}
          onRequestOpenFile={setPreview} onOpenSettings={() => execution.onOpenSettings('execution')}
          onSubmitQuestionForm={async (text, attachments = [], context, sourceId) => {
            const source = messagesRef.current.find((message) => message.id === sourceId);
            return (await send(text, attachments, [], { context }, source?.strategyTaskExecutionId)) !== 'restore-draft';
          }}
          questionFormSubmitDisabled={loading || streaming || loadFailed}
          composerFooterAccessory={<AvatarMenu {...execution} placement="up" />}
          config={execution.config} />
      </div>
      {files.length > 0 ? <aside className={styles.files} aria-label={t('designFiles.title')}>
        <h2>{t('designFiles.title')}</h2>
        {files.map((file) => <Button variant="ghost" key={file.name} onClick={() => setPreview(file.name)}><Icon name="file" size={16} /><span>{file.name}</span></Button>)}
      </aside> : null}
    </div>
    {dialog ? <Dialog closeOnEscape onClose={() => { if (!saving) setDialog(null); }} ariaLabelledBy="standalone-manage-title">
      <DialogTitle id="standalone-manage-title">{dialog === 'delete' ? t('chat.deleteConversation') : t('common.rename')}</DialogTitle>
      {dialog === 'delete' ? <p>{t('chat.deleteConversationConfirm', { title })}</p> : <Input aria-label={t('common.rename')} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoFocus />}
      <DialogFooter><Button onClick={() => setDialog(null)} disabled={saving}>{t('common.cancel')}</Button><Button disabled={saving || (dialog === 'rename' && !titleDraft.trim())} onClick={() => void saveDialog()}>{dialog === 'delete' ? t('common.delete') : t('common.save')}</Button></DialogFooter>
    </Dialog> : null}
    {preview ? <Dialog closeOnEscape className={styles.preview} onClose={() => setPreview(null)} ariaLabelledBy="standalone-preview-title">
      <DialogTitle id="standalone-preview-title">{preview}</DialogTitle>
      {currentPreview?.error ? <div className={styles.previewStatus} role="alert"><span>{currentPreview.error}</span><Button onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>{t('preview.retry')}</Button></div>
        : currentPreview?.url ? <iframe title={preview} src={currentPreview.url} sandbox="allow-scripts" />
          : <div className={styles.previewStatus} role="status">{t('common.loading')}</div>}
      <DialogFooter><a href={fileUrl(preview)} download>{t('ds.download')}</a><Button onClick={() => setPreview(null)}>{t('common.close')}</Button></DialogFooter>
    </Dialog> : null}
  </section>;
}
