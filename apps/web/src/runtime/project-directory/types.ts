export interface TerminalLaunchResult {
  kind: 'host' | 'web-fallback';
  ok: boolean;
}

export interface TerminalLauncher {
  isHost: boolean;
  open: (projectId: string) => Promise<TerminalLaunchResult>;
}
