import type { ClientContext } from './types';
export function readClientContext(): ClientContext {
  return { type: 'web' };
}
export function syncWindowTheme(_theme: 'light' | 'dark' | 'system'): void {}
export function setPetVisible(_visible: boolean): void {}
export function installWindowFocusAppearance(): (() => void) | undefined {
  return undefined;
}
