import { useState } from 'react';
import { workspaceContextHasTeamIdentity, type Project, type WorkspaceCollabContext, type WorkspaceProjectSummary, type ProjectDisplayStatus } from '@open-design/contracts';
import type { TrackingProjectCollectionPage } from '@open-design/contracts/analytics';
import type { SharedProjectPredicate } from '../../collab/all-projects-list';
import { acknowledgeProjectCompletion } from '../../hooks/useProjectRunStatuses';
import { RailRecentRow, openRailRecentRowMenu, closeRailRecentRowMenu } from '../entry-nav-rail/RailRecentRow';
import { MoveToTeamConfirmDialog, moveConfirmSkipped } from '../MoveToTeamConfirmDialog';
import { ProjectDeleteConfirmDialog } from './ProjectDeleteConfirmDialog';
import { projectOwnedBySelf } from './ownership';
import { useProjectDeleteFlow, type ProjectDeleteHandler } from './useProjectDeleteFlow';
import { useProjectDuplicateFlow, type ProjectDuplicateHandler } from './useProjectDuplicateFlow';
import { useWorkspaceProjectMove } from './useWorkspaceProjectMove';

export interface SidebarProjectActionProps {
  onRenameRecentProject?: (id: string, name: string) => void;
  onDeleteRecentProject?: ProjectDeleteHandler;
  onDuplicateRecentProject?: ProjectDuplicateHandler;
  isSharedRecentProject?: SharedProjectPredicate;
  recentProjectOwnerMemberIds?: ReadonlyMap<string, string>;
  onRecentProjectShared?: (project: WorkspaceProjectSummary) => void;
  onRecentProjectShareFailed?: (projectId: string) => void;
  analyticsPage?: TrackingProjectCollectionPage;
}

/** Retain the existing row menus and their authoritative mutation/confirmation flows. */
export function useSidebarProjectActions(input: SidebarProjectActionProps & {
  workspaceContext: WorkspaceCollabContext | null;
  onOpenProject: (id: string) => void | Promise<unknown>;
}) {
  const { workspaceContext, analyticsPage = 'home' } = input;
  const isShared = input.isSharedRecentProject ?? (() => false);
  const deleteFlow = useProjectDeleteFlow({ onDelete: input.onDeleteRecentProject, analyticsPage, workspaceContext });
  const duplicateFlow = useProjectDuplicateFlow({ onDuplicate: input.onDuplicateRecentProject, analyticsPage, workspaceContext });
  const moveFlow = useWorkspaceProjectMove({
    workspaceContext, analyticsPage,
    onProjectShared: input.onRecentProjectShared,
    onProjectShareFailed: input.onRecentProjectShareFailed,
    onMoveStart: (project) => openRailRecentRowMenu(project.id),
    onMoveSettled: (project, _action, ok) => { if (ok) closeRailRecentRowMenu(project.id); },
  });
  const [moveTarget, setMoveTarget] = useState<Project | null>(null);
  const moveToTeamAvailable = workspaceContextHasTeamIdentity(workspaceContext)
    && workspaceContext?.permissions.canShareProjects === true;
  return {
    renderProjectRow: (project: Project, runStatus?: ProjectDisplayStatus) => (
      <RailRecentRow
        project={project}
        workspaceContext={workspaceContext}
        runStatus={runStatus}
        runId={project.status?.runId}
        ownedBySelf={projectOwnedBySelf({ projectId: project.id, ownerMemberIds: input.recentProjectOwnerMemberIds, selfMemberId: workspaceContext?.workspaceMemberId, isShared })}
        shared={isShared(project.id)}
        moveToTeamAvailable={moveToTeamAvailable}
        sharing={moveFlow.sharingId === project.id}
        shareError={moveFlow.error?.projectId === project.id ? moveFlow.error.kind : null}
        onOpen={(id) => { acknowledgeProjectCompletion(id); return input.onOpenProject(id); }}
        onRename={input.onRenameRecentProject}
        onDuplicate={input.onDuplicateRecentProject ? (target) => { void duplicateFlow.duplicate(target); } : undefined}
        onMoveToTeam={(target) => {
          if (moveConfirmSkipped()) void moveFlow.shareToTeam(target);
          else setMoveTarget(target);
        }}
        onDelete={input.onDeleteRecentProject ? deleteFlow.request : undefined}
      />
    ),
    dialogs: <>
      {deleteFlow.target ? <ProjectDeleteConfirmDialog
        projectName={deleteFlow.target.name}
        activeShareCount={deleteFlow.activeShareCount}
        shareReadStatus={deleteFlow.shareReadStatus}
        pending={deleteFlow.pending}
        failed={deleteFlow.failed}
        onCancel={deleteFlow.cancel}
        onConfirm={() => void deleteFlow.commit()}
      /> : null}
      {moveTarget ? <MoveToTeamConfirmDialog action="to-team" onCancel={() => setMoveTarget(null)} onConfirm={() => {
        const target = moveTarget;
        setMoveTarget(null);
        void moveFlow.shareToTeam(target);
      }} /> : null}
    </>,
  };
}
