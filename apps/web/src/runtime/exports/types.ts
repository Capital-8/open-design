import type { WorkspaceCollabContext } from '@open-design/contracts';

export type ProjectPdfExportResult = 'desktop' | 'download' | 'fallback' | 'cancelled';

export type ProjectMp4ExportOptions = {
  projectId: string; fileName: string; title: string; signal?: AbortSignal;
};

export type ProjectPdfExportOptions = {
  deck: boolean;
  fallbackPdf: () => void | Promise<void>;
  filePath: string;
  projectId: string;
  title: string;
  versionId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
};

export type ProjectZipExportOptions = {
  projectId: string;
  filePath: string;
  fallbackHtml: string;
  fallbackTitle: string;
  versionId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
};

export type ProjectScreenshotExportOptions = {
  projectId: string;
  fileName: string;
  title?: string;
  format?: 'pptx' | 'pdf';
  deck?: boolean;
  versionId?: string;
  // pptx only: produce an editable deck (native shapes/text) instead of a
  // screenshot one (one image per slide).
  editable?: boolean;
  workspaceContext?: WorkspaceCollabContext | null;
};

export type ProjectImageExportOptions = {
  projectId: string;
  fileName: string;
  index?: number;
  deck?: boolean;
  width?: number;
  height?: number;
  versionId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
};

export type ProjectScreenshotPdfOptions = {
  projectId: string;
  fileName: string;
  title?: string;
  deck?: boolean;
  versionId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
};
