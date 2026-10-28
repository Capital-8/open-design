import { useMemo } from 'react';
import { createProjectDirectoryLauncher } from '../runtime/project-directory';
export type { TerminalLaunchResult, TerminalLauncher } from '../runtime/project-directory/types';

// Opens the project in the OS file manager; browser callers show manual instructions.
export function useTerminalLaunch() {
  return useMemo(createProjectDirectoryLauncher, []);
}
