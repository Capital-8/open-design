import { useEffect, useState } from 'react';
import { motionSourceFingerprint, type MotionStructureResponse, type WorkspaceCollabContext } from '@open-design/contracts';
import { inspectMotionStructure } from '../providers/motion';

export function useMotionStructure(projectId: string, filePath: string, source: string | null, enabled: boolean, workspace?: WorkspaceCollabContext | null) {
  const identity = `${projectId}\0${filePath}\0${source === null ? '' : motionSourceFingerprint(source)}`;
  const [result, setResult] = useState<{ identity: string; structure: MotionStructureResponse | null } | null>(null);
  useEffect(() => {
    if (!enabled || source === null) return;
    const abort = new AbortController();
    void inspectMotionStructure(projectId, filePath, source, abort.signal, workspace).then(structure => {
      if (!abort.signal.aborted && structure.sourceFingerprint === motionSourceFingerprint(source)
        && Array.isArray(structure.scenes) && Array.isArray(structure.texts) && Array.isArray(structure.audio) && Array.isArray(structure.captions)) {
        setResult({ identity, structure });
      }
    }).catch(() => { if (!abort.signal.aborted) setResult({ identity, structure: null }); });
    return () => abort.abort();
  }, [projectId, filePath, source, enabled, identity, workspace]);
  return { structure: enabled && result?.identity === identity ? result.structure : null, loading: enabled && result?.identity !== identity };
}
