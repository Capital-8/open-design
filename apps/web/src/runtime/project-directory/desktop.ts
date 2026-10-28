import { isOpenDesignHostAvailable, openHostProjectPath } from '@open-design/host';
import type { TerminalLauncher } from './types';
import { createProjectDirectoryLauncher as browserLauncher } from './browser';
export function createProjectDirectoryLauncher(): TerminalLauncher {
  if (!isOpenDesignHostAvailable()) return browserLauncher();
  return {
    isHost: true,
    open: async (projectId) => {
      try {
        return { kind: 'host', ok: (await openHostProjectPath(projectId)).ok };
      } catch {
        return { kind: 'host', ok: false };
      }
    },
  };
}
