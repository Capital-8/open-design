import { useEffect, useState } from 'react';
import { isCloudIndexLink } from '../../runtime/cloud-file-preview';
import { CloudFilePreview } from './Preview';
import type { MessageFilePreviewProps } from './types';

export function MessageFilePreview({ projectId, children, onClickCapture, ...props }: MessageFilePreviewProps) {
  const [previewProject, setPreviewProject] = useState<string | null>(null);
  useEffect(() => { setPreviewProject(null); }, [projectId]);
  return <div {...props} onClickCapture={event => {
    onClickCapture?.(event);
    if (event.defaultPrevented || !projectId) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || !isCloudIndexLink(link.getAttribute('href') ?? '')) return;
    event.preventDefault(); event.stopPropagation();
    setPreviewProject(projectId);
  }}>
    {previewProject && previewProject === projectId && <CloudFilePreview key={previewProject}
      projectId={previewProject} onClose={() => setPreviewProject(null)} />}
    {children}
  </div>;
}
