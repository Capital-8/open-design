export interface BrowserSurfaceProps {
  src: string;
  title: string;
  onNativeView: (node: HTMLWebViewElement | null) => void;
  onFrameLoad: (frame: HTMLIFrameElement) => void;
}
