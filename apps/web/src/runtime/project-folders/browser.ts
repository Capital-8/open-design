import { openFolderDialog } from '../../providers/registry';
import { pickLocalFolderPath } from '../../state/projects';
import type { WorkingDirPick, FolderImportOptions, FolderImportError } from './types';
export async function pickWorkingDir(options?: {
  throwOnError?: boolean;
}): Promise<WorkingDirPick> {
  const baseDir = await openFolderDialog(options);
  return baseDir ? { ok: true, baseDir, token: null } : { ok: false, canceled: true };
}
export function canImportFolder(
  options: Pick<FolderImportOptions, 'onImportFolder' | 'onImportFolderResponse'>,
): boolean {
  return Boolean(options.onImportFolder);
}
export async function importFolder(
  options: FolderImportOptions,
): Promise<FolderImportError | null> {
  if (!options.onImportFolder) return null;
  const path = await pickLocalFolderPath();
  if (path) await options.onImportFolder(path);
  return null;
}
