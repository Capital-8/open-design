import { getOpenDesignHost, setHostPetVisible } from '@open-design/host';
import type { ClientContext } from './types';
export function readClientContext(): ClientContext {
  const host = getOpenDesignHost();
  return host ? { ...host.client } : { type: 'web' };
}
export function syncWindowTheme(theme: 'light' | 'dark' | 'system'): void {
  getOpenDesignHost()?.appearance?.setTheme(theme);
}
export function setPetVisible(visible: boolean): void {
  setHostPetVisible(visible);
}

export function installWindowFocusAppearance(): (() => void) | undefined {
  if (typeof window === 'undefined' || readClientContext().platform !== 'darwin') return undefined;
  const root = document.documentElement;
  const sync = () => root.classList.toggle('is-window-blurred', !document.hasFocus());
  sync();
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  return () => {
    window.removeEventListener('focus', sync);
    window.removeEventListener('blur', sync);
    root.classList.remove('is-window-blurred');
  };
}
