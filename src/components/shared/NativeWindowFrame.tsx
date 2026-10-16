import { useEffect, useState, type ReactNode } from "react";
import { isTerminalApp } from "@/platform-config/platform";
import { hasFeature } from "@/platform-config/features";
import { installNativeZoomLock } from "@/lib/native-zoom";

/** Caption controls are native; only this empty, non-interactive strip drags. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  const [caption, setCaption] = useState(false);
  useEffect(() => {
    const windows = hasFeature("windowChrome") && /Windows/i.test(navigator.userAgent) && !window.location.pathname.startsWith("/display");
    setCaption(windows);
    if (windows) document.documentElement.setAttribute("data-native-caption", "true");
    const stopZoom = isTerminalApp() ? installNativeZoomLock(window, document) : undefined;
    return () => {
      stopZoom?.();
      document.documentElement.removeAttribute("data-native-caption");
    };
  }, []);
  return <>
    {caption && <div className="native-caption" aria-hidden="true" />}
    {children}
  </>;
}
