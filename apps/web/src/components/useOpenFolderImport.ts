import { useCallback, useState } from 'react';
import type { OpenDesignHostProjectImportSuccess } from '@open-design/host';
import { canImportFolder, importFolder } from '../runtime/project-folders';
import { resolvedWorkspaceContextForWrite } from '../state/projects';
import { useWorkspaceContext } from '../collab/useWorkspaceContext';

interface UseOpenFolderImportArgs {
  skillId?: string | null;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenDesignHostProjectImportSuccess) => Promise<void> | void;
}

export function useOpenFolderImport({
  skillId,
  onImportFolder,
  onImportFolderResponse,
}: UseOpenFolderImportArgs) {
  const workspaceContextState = useWorkspaceContext();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const available = canImportFolder({ onImportFolder, onImportFolderResponse });
  const openFolder = useCallback(async () => {
    if (!available) return;
    setError(null);
    setImporting(true);
    try {
      setError(await importFolder({
        skillId, onImportFolder, onImportFolderResponse,
        workspaceContext: () => resolvedWorkspaceContextForWrite(workspaceContextState),
      }));
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Failed to import folder' });
    } finally { setImporting(false); }
  }, [available, onImportFolder, onImportFolderResponse, skillId, workspaceContextState]);

  return {
    available,
    clearError: () => setError(null),
    error,
    importing,
    openFolder,
  };
}
