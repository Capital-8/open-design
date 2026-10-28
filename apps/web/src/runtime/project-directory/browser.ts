import type { TerminalLauncher } from './types';
export function createProjectDirectoryLauncher(): TerminalLauncher {
  return { isHost: false, open: async () => ({ kind: 'web-fallback', ok: true }) };
}
