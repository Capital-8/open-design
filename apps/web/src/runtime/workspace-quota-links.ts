import { AMR_CONSOLE_UPGRADE_INTENT, amrConsoleUrlForProfile, amrWorkspaceUrl } from './amr-guidance';

/** Balance is a view link; only the owner upgrade asks for plans. */
export function quotaPopoverConsoleUrl(
  profile: string | null | undefined,
  workspaceId: string | null | undefined,
  intent: 'console' | 'plans' = 'console',
  consoleOrigin?: string | null,
): string | null {
  return amrWorkspaceUrl(
    amrConsoleUrlForProfile(profile, consoleOrigin),
    workspaceId,
    intent === 'plans' ? AMR_CONSOLE_UPGRADE_INTENT : undefined,
  );
}
