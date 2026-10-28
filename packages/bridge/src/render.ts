import { requireCapability } from './register.js';

export type RenderFormat = 'pdf' | 'pdf-image' | 'pptx' | 'image' | 'mp4';
export interface RenderRequest {
  html: string; format: RenderFormat; deck?: boolean; editable?: boolean;
  index?: number; width?: number; height?: number;
}
export type RenderCapabilities =
  | { available: false; reason: string }
  | { available: true; formats: readonly RenderFormat[]; editablePptx: boolean;
      limits: { maxInputBytes: number; maxOutputBytes: number } };
export interface RenderResult { bytes: Uint8Array; mimeType: string; format: RenderFormat }
export interface Render {
  getCapabilities(): Promise<RenderCapabilities>;
  render(request: RenderRequest): Promise<RenderResult>;
}
export const render: Readonly<Render> = Object.freeze({
  async getCapabilities() { return requireCapability('render').getCapabilities(); },
  async render(request) { return requireCapability('render').render(request); },
} satisfies Render);
