import {
  isOpenDesignHostAvailable,
  pickHostWorkingDir,
  pickAndImportHostProject,
} from '@open-design/host';
import * as browser from './browser';
import { formatPickAndImportFailure } from '../../utils/pickAndImportError';
import type { WorkingDirPick, FolderImportOptions, FolderImportError } from './types';
export async function pickWorkingDir(options?: {
  throwOnError?: boolean;
}): Promise<WorkingDirPick> {
  if (!isOpenDesignHostAvailable()) return browser.pickWorkingDir(options);
  const result = await pickHostWorkingDir();
  if (result.ok) return { ok: true, baseDir: result.baseDir, token: result.token };
  if ('canceled' in result && result.canceled) return { ok: false, canceled: true };
  // A present host must mint the token. Falling back to a raw path would bypass
  // the picker and produce an unauthorised write later in project creation.
  return {
    ok: false,
    error: `Couldn't open the folder picker (${'reason' in result ? result.reason : 'host unavailable'}). Please update OpenDesign and try again.`,
  };
}
export function canImportFolder(
  options: Pick<FolderImportOptions, 'onImportFolder' | 'onImportFolderResponse'>,
): boolean {
  return isOpenDesignHostAvailable()
    ? Boolean(options.onImportFolderResponse)
    : browser.canImportFolder(options);
}
export async function importFolder(
  options: FolderImportOptions,
): Promise<FolderImportError | null> {
  if (!isOpenDesignHostAvailable()) return browser.importFolder(options);
  if (!options.onImportFolderResponse) return null;
  const result = await pickAndImportHostProject({
    skillId: options.skillId ?? null,
    workspaceContext: options.workspaceContext(),
  });
  if (!result) return null;
  if (result.ok) {
    await options.onImportFolderResponse(result);
    return null;
  }
  if ('canceled' in result && result.canceled) return null;
  return formatPickAndImportFailure(result);
}
