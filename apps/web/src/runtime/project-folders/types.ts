import type { OpenDesignHostProjectImportSuccess } from '@open-design/host';
import type { WorkspaceCollabContext } from '@open-design/contracts';
export type WorkingDirPick =
  | { ok: true; baseDir: string; token: string | null }
  | { ok: false; canceled: true }
  | { ok: false; error: string };
export interface FolderImportOptions {
  skillId?: string | null;
  workspaceContext: () => WorkspaceCollabContext | null;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenDesignHostProjectImportSuccess) => Promise<void> | void;
}
export type FolderImportError = { message: string; details?: string };
