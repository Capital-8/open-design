/** Static declarations in the exact HTML source being inspected. */
export interface MotionStructureRequest {
  filePath: string;
  source?: string;
}

export interface MotionStructureItem {
  id: string;
  kind: 'scene' | 'text' | 'audio' | 'caption';
  label: string;
  text?: string;
  /** Present only when the source element can be uniquely selected. */
  selector?: string;
  start?: number;
  duration?: number;
  sceneId?: string;
  src?: string;
}

export interface MotionStructureResponse {
  sourceFingerprint: string;
  composition: { id: string; duration: number; width: number; height: number } | null;
  scenes: MotionStructureItem[];
  texts: MotionStructureItem[];
  audio: MotionStructureItem[];
  captions: MotionStructureItem[];
  warnings: string[];
}

/** Preview identity only: this is not a cryptographic integrity check. */
export function motionSourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return `${source.length}:${(hash >>> 0).toString(16)}`;
}
