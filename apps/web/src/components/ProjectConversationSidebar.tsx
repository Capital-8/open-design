import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '@open-design/components';
import type { Conversation, Project, ProjectDisplayStatus, WorkspaceCollabContext } from '@open-design/contracts';
import { currentWorkspaceAccountGeneration, workspaceIdentityCacheKey } from '../collab/workspace-identity';
import { useT } from '../i18n';
import { listConversations } from '../state/projects';
import { useProjectRunStatuses } from '../hooks/useProjectRunStatuses';
import { Icon } from './Icon';
import { useSidebarProjectActions, type SidebarProjectActionProps } from './project-actions/useSidebarProjectActions';
import styles from './ProjectConversationSidebar.module.css';

export interface ProjectConversationSidebarProps extends SidebarProjectActionProps {
  /** The caller supplies the already-authorized, workspace-scoped catalogue. */
  projects: readonly Project[];
  workspaceContext: WorkspaceCollabContext | null;
  onOpenProject: (projectId: string) => void | Promise<unknown>;
  onOpenConversation: (projectId: string, conversationId: string) => void | Promise<unknown>;
  onNewProject: () => void;
  onNewConversation: () => void;
  onBrowseProjects: () => void;
  /** False while the column is collapsed/hidden: retire status and conversation reads. */
  enabled?: boolean;
  catalogLoading?: boolean;
  /** Authority is unknown after a failed identity read; the header owns recovery. */
  catalogUnavailable?: boolean;
  newProjectDisabled?: boolean;
  newConversationDisabled?: boolean;
  activeProjectId?: string | null;
  activeConversationId?: string | null;
  /** Optional status override. Otherwise only visible rows subscribe to the shared feed. */
  projectRunStatuses?: ReadonlyMap<string, ProjectDisplayStatus>;
  /** Workspace switching/search and the conversation catalogue keep their own owners. */
  headerSlot?: ReactNode;
  /** Existing row menus/ownership/confirmation flows can render beside the disclosure. */
  renderProjectRow?: (project: Project, runStatus?: ProjectDisplayStatus) => ReactNode;
  conversationsSlot?: ReactNode;
  className?: string;
}

type ConversationRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; conversations: Conversation[] };

function ProjectTreeRow({
  project,
  workspaceContext,
  onOpenConversation,
  enabled = true,
  activeProjectId,
  activeConversationId,
  runStatus,
  renderProjectRow,
}: Pick<ProjectConversationSidebarProps, 'workspaceContext' | 'enabled' | 'onOpenConversation' | 'activeProjectId' | 'activeConversationId' | 'renderProjectRow'> & {
  project: Project;
  runStatus?: ProjectDisplayStatus;
}) {
  const t = useT();
  const childrenId = useId();
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<ConversationRead>({ status: 'loading' });
  const contextRef = useRef(workspaceContext);
  contextRef.current = workspaceContext;

  useEffect(() => {
    if (!expanded || !enabled) return;
    let current = true;
    setRead({ status: 'loading' });
    void listConversations(project.id, {
      workspaceContext: contextRef.current,
      throwOnError: true,
    }).then((conversations) => {
      if (current) setRead({ status: 'ready', conversations });
    }).catch(() => {
      if (current) setRead({ status: 'error' });
    });
    // Collapsing, removing the project, or changing authority unmounts/invalidates
    // the reader. A delayed response must never populate a different tree.
    return () => { current = false; };
  }, [project.id, project.updatedAt, expanded, attempt, enabled]);

  return (
    <li className={styles.project} data-project-id={project.id}>
      <div className={styles.projectRow}>
        <Button
          variant="ghost"
          size="icon"
          className={styles.disclosure}
          aria-label={t(expanded ? 'homeSidebar.collapseProject' : 'homeSidebar.expandProject', { name: project.name })}
          aria-expanded={expanded}
          aria-controls={childrenId}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name="chevron-right" size={14} className={expanded ? styles.expandedChevron : styles.chevron} />
        </Button>
        <div className={styles.customProjectRow} aria-current={activeProjectId === project.id && !activeConversationId ? 'page' : undefined}>
          {renderProjectRow?.(project, runStatus)}
        </div>
      </div>
      <div className={styles.children} id={childrenId} hidden={!expanded}>
        {expanded && read.status === 'loading' ? <p className={styles.message} role="status">{t('common.loading')}</p> : null}
        {expanded && read.status === 'error' ? (
          <div className={styles.readError}>
            <p className={styles.message} role="alert">{t('homeSidebar.conversationsLoadFailed')}</p>
            <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>{t('homeSidebar.retry')}</Button>
          </div>
        ) : null}
        {expanded && read.status === 'ready' && read.conversations.length === 0 ? <p className={styles.message}>{t('homeSidebar.noConversations')}</p> : null}
        {expanded && read.status === 'ready' && read.conversations.length > 0 ? (
          <ul className={styles.conversationList}>
            {read.conversations.map((conversation) => {
              const title = conversation.title?.trim() || t('chat.untitledConversation');
              return (
                <li key={conversation.id}>
                  <Button
                    variant="ghost"
                    className={styles.conversationLink}
                    title={title}
                    aria-current={activeProjectId === project.id && activeConversationId === conversation.id ? 'page' : undefined}
                    onClick={() => onOpenConversation(project.id, conversation.id)}
                  >
                    <Icon name="comment" size={15} />
                    <span className={styles.name}>{title}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function ScopedProjectTree(props: ProjectConversationSidebarProps & { scrollRoot: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const actions = useSidebarProjectActions(props);
  // Match the former recent-project rail: every project, newest update first.
  const projects = useMemo(() => [...props.projects].sort((a, b) => b.updatedAt - a.updatedAt), [props.projects]);
  const listRef = useRef<HTMLUListElement>(null);
  const enabled = props.enabled !== false;
  const visibilityScope = JSON.stringify(projects.map((project) => project.id));
  const [visible, setVisible] = useState<{ scope: string; ids: string[] } | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!enabled || props.projectRunStatuses || !list || typeof IntersectionObserver === 'undefined') return;
    let current = true;
    const ids = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      if (!current) return;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.projectId;
        if (!id) continue;
        if (entry.isIntersecting) ids.add(id);
        else ids.delete(id);
      }
      const next = [...ids].sort();
      setVisible((previous) => previous?.scope === visibilityScope && previous.ids.join('\0') === next.join('\0')
        ? previous : { scope: visibilityScope, ids: next });
    }, { root: props.scrollRoot.current });
    for (const row of list.children) observer.observe(row);
    return () => { current = false; observer.disconnect(); };
  }, [enabled, props.projectRunStatuses, props.scrollRoot, visibilityScope]);
  // Same bounded initial head as the former rail; the observer replaces it with
  // the exact scrollport intersection, including an empty set when offscreen.
  const statusIds = visible?.scope === visibilityScope ? visible.ids : projects.slice(0, 11).map((project) => project.id);
  const liveStatuses = useProjectRunStatuses(statusIds, {
    enabled: enabled && !props.projectRunStatuses,
    workspaceContext: props.workspaceContext,
  });
  const statuses = props.projectRunStatuses ?? liveStatuses;
  return (
    <>
      {props.catalogLoading ? <p className={styles.message} role="status">{t('common.loading')}</p>
        : props.projects.length === 0 ? <p className={styles.message}>{t('recentProjects.empty')}</p> : null}
      <ul ref={listRef} className={styles.projectList}>
        {projects.map((project) => (
          <ProjectTreeRow
            key={project.id}
            project={project}
            workspaceContext={props.workspaceContext}
            enabled={enabled}
            onOpenConversation={props.onOpenConversation}
            activeProjectId={props.activeProjectId}
            activeConversationId={props.activeConversationId}
            runStatus={statuses.get(project.id)}
            renderProjectRow={props.renderProjectRow ?? actions.renderProjectRow}
          />
        ))}
      </ul>
      {actions.dialogs}
    </>
  );
}

export function ProjectConversationSidebar(props: ProjectConversationSidebarProps) {
  const t = useT();
  const scrollRoot = useRef<HTMLDivElement>(null);
  // Remount on every authority change, including a same-workspace account cycle.
  // This clears expanded state and cached results before the new tree is painted.
  const scope = `${currentWorkspaceAccountGeneration()}:${workspaceIdentityCacheKey(props.workspaceContext)}`;
  return (
    <aside className={[styles.sidebar, props.className].filter(Boolean).join(' ')} aria-label={t('homeSidebar.label')}>
      {props.headerSlot}
      <div className={styles.createActions}>
        <Button variant="secondary" className={styles.createButton} onClick={props.onNewProject} disabled={props.newProjectDisabled}>
          <Icon name="plus" size={15} />{t('entry.navNewProject')}
        </Button>
        <Button variant="secondary" className={styles.createButton} onClick={props.onNewConversation} disabled={props.newConversationDisabled}>
          <Icon name="edit" size={15} />{t('homeSidebar.newConversation')}
        </Button>
      </div>
      <div ref={scrollRoot} className={styles.scrollArea}>
        <section aria-label={t('entry.navProjects')}>
          <div className={styles.sectionHeader}>
            <h2>{t('entry.navProjects')}</h2>
            <Button variant="ghost" className={styles.browseButton} onClick={props.onBrowseProjects}>{t('entry.navDrafts')}</Button>
          </div>
          {!props.catalogUnavailable ? <ScopedProjectTree key={scope} {...props} scrollRoot={scrollRoot} /> : null}
        </section>
        {!props.catalogUnavailable && props.conversationsSlot ? <div className={styles.conversationsSection} key={scope}>{props.conversationsSlot}</div> : null}
      </div>
    </aside>
  );
}
