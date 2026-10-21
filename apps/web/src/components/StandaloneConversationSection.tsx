import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { StandaloneConversation, WorkspaceCollabContext } from '@open-design/contracts';
import { currentWorkspaceAccountGeneration, workspaceIdentityCacheKey } from '../collab/workspace-identity';
import { useT } from '../i18n';
import { navigate } from '../router';
import { RUNS_CHANGED_EVENT } from '../providers/daemon';
import {
  createStandaloneConversation,
  listStandaloneConversations,
  STANDALONE_CONVERSATIONS_CHANGED_EVENT,
} from '../state/standalone-conversations';
import { Icon } from './Icon';
import styles from './StandaloneConversationSection.module.css';

type CatalogState = {
  scope: string;
  rows: StandaloneConversation[];
  loading: boolean;
  failed: boolean;
  createFailed: boolean;
  creating: boolean;
};

export function useStandaloneConversationCatalog(context: WorkspaceCollabContext | null, enabled = true) {
  const scope = `${currentWorkspaceAccountGeneration()}:${workspaceIdentityCacheKey(context)}`;
  const current = useRef({ scope, context, enabled });
  current.current = { scope, context, enabled };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sequence = useRef(0);
  const creating = useRef<string | null>(null);
  const [state, setState] = useState<CatalogState>({
    scope, rows: [], loading: true, failed: false, createFailed: false, creating: false,
  });
  const refresh = useCallback(async (background = false) => {
    const issued = current.current;
    if (!issued.enabled) return;
    const requestId = ++sequence.current;
    setState((previous) => ({
      scope: issued.scope, rows: previous.scope === issued.scope ? previous.rows : [],
      loading: background && previous.scope === issued.scope ? previous.loading : true, failed: false,
      createFailed: previous.scope === issued.scope && previous.createFailed,
      creating: creating.current === issued.scope,
    }));
    try {
      const rows = await listStandaloneConversations(issued.context);
      if (current.current.scope !== issued.scope || requestId !== sequence.current || !current.current.enabled) return;
      setState((previous) => ({ ...previous, rows, loading: false, failed: false }));
    } catch {
      if (current.current.scope !== issued.scope || requestId !== sequence.current || !current.current.enabled) return;
      setState((previous) => ({ ...previous, rows: [], loading: false, failed: true }));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    const runsChanged = () => { void refresh(true); };
    window.addEventListener(STANDALONE_CONVERSATIONS_CHANGED_EVENT, changed);
    window.addEventListener(RUNS_CHANGED_EVENT, runsChanged);
    const timer = enabled ? window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh(true);
    }, 4000) : undefined;
    return () => {
      ++sequence.current;
      window.removeEventListener(STANDALONE_CONVERSATIONS_CHANGED_EVENT, changed);
      window.removeEventListener(RUNS_CHANGED_EVENT, runsChanged);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [scope, enabled, refresh]);

  const create = useCallback(async () => {
    const issued = current.current;
    if (!issued.enabled || creating.current === issued.scope) return;
    creating.current = issued.scope;
    setState((previous) => ({ ...previous, creating: true, createFailed: false }));
    try {
      const conversation = await createStandaloneConversation({}, issued.context);
      if (!mounted.current || current.current.scope !== issued.scope || !current.current.enabled) return;
      navigate({ kind: 'standalone-conversation', conversationId: conversation.id });
    } catch {
      if (current.current.scope === issued.scope) setState((previous) => ({ ...previous, createFailed: true }));
    } finally {
      if (creating.current === issued.scope) creating.current = null;
      if (current.current.scope === issued.scope) setState((previous) => ({ ...previous, creating: false }));
    }
  }, []);
  return {
    ...(enabled && state.scope === scope ? state : { scope, rows: [], loading: true, failed: false, creating: false, createFailed: false }),
    refresh, create,
  };
}

export function StandaloneConversationSection({ catalog }: {
  catalog: ReturnType<typeof useStandaloneConversationCatalog>;
}) {
  const t = useT();
  return (
    <section className={styles.section} aria-label={t('homeSidebar.conversations')}>
      <h2>{t('homeSidebar.conversations')}</h2>
      {catalog.createFailed ? <p role="alert">{t('homeSidebar.createFailed')}</p> : null}
      {catalog.failed ? (
        <div className={styles.status} role="alert">
          <span>{t('homeSidebar.conversationsLoadFailed')}</span>
          <Button variant="ghost" onClick={() => void catalog.refresh()}>{t('homeSidebar.retry')}</Button>
        </div>
      ) : catalog.loading && catalog.rows.length === 0 ? (
        <p role="status">{t('common.loading')}</p>
      ) : catalog.rows.length === 0 ? (
        <p>{t('homeSidebar.noConversations')}</p>
      ) : (
        <ul>
          {catalog.rows.map((conversation) => (
            <li key={conversation.id}>
              <Button variant="ghost" className={styles.row} title={conversation.title ?? undefined}
                onClick={() => navigate({ kind: 'standalone-conversation', conversationId: conversation.id })}>
                <Icon name="comment" size={16} />
                <span>{conversation.title || t('chat.untitledConversation')}</span>
                {conversation.runStatus ? (
                  <small className={styles.runStatus} data-status={conversation.runStatus}>
                    {t(`designs.status.${conversation.runStatus}`)}
                  </small>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
