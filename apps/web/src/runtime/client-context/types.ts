export interface ClientContext {
  type: 'desktop' | 'web';
  platform?: string;
  osLocale?: string;
}
