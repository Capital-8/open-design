import { isOpenDesignHostAvailable } from '@open-design/host';
import { useCallback, type ReactNode } from 'react';
import { BrowserFrame } from './Frame';
import type { BrowserSurfaceProps } from './types';
export function BrowserSurface(props: BrowserSurfaceProps) {
  const assign = useCallback(
    (node: HTMLWebViewElement | null) => {
      if (node) node.setAttribute('allowpopups', 'true');
      props.onNativeView(node);
    },
    [props.onNativeView],
  );
  if (!isOpenDesignHostAvailable()) return <BrowserFrame {...props} />;
  return (
    <webview
      ref={assign}
      className="db-webview"
      src={props.src}
      partition="persist:open-design-design-browser"
      title={props.title}
    />
  );
}

export function BrowserCaptureControl({ children }: { children: ReactNode }) {
  return isOpenDesignHostAvailable() ? <>{children}</> : null;
}
