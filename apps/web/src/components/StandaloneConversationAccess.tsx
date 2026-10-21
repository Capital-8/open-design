import type { ReactNode } from 'react';
import { Button } from '@open-design/components';
import { retryWorkspaceContextRead, type WorkspaceContextState } from '../collab/useWorkspaceContext';
import { useT } from '../i18n';
import { CloudSignInTip, RailAccountRecoveryTip } from './CloudSignInTip';
import { CenteredLoader } from './Loading';

/** Unknown workspace authority must never become a headerless local read. */
export function StandaloneConversationAccess({ state, children }: {
  state: Pick<WorkspaceContextState, 'loading' | 'identityChangePending' | 'failure'>;
  children: ReactNode;
}) {
  const t = useT();
  if (state.loading || state.identityChangePending) return <CenteredLoader />;
  if (state.failure === 'unavailable') {
    return <div className="centered-loader" data-testid="standalone-workspace-recovery">
      <RailAccountRecoveryTip />
      <Button onClick={retryWorkspaceContextRead}>{t('preview.retry')}</Button>
    </div>;
  }
  if (state.failure === 'reauth-required') {
    return <div className="centered-loader"><CloudSignInTip sharePrompt /></div>;
  }
  // An explicit signed-out/local result and legacy unsupported daemon remain
  // legal local scopes. Only a failed modern identity read is blocked above.
  return <>{children}</>;
}
