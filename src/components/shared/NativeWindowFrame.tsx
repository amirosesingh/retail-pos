import { useEffect, useState, type ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { isTerminalApp } from "@/platform-config/platform";
import { hasFeature, isMobileShell } from "@/platform-config/features";
import { installNativeZoomLock } from "@/lib/native-zoom";

type WindowControls = {
  minimizeWindow?: () => Promise<unknown>;
  toggleMaximizeWindow?: () => Promise<{ maximized: boolean }>;
  closeWindow?: () => Promise<unknown>;
  isWindowMaximized?: () => Promise<{ maximized: boolean }>;
  onWindowState?: (callback: (state: { maximized: boolean }) => void) => () => void;
};
const controls = () => (window as unknown as { pos?: WindowControls }).pos;
const run = (action?: () => Promise<unknown>) => { void action?.().catch(() => {}); };

/** Only the caption background drags. Buttons use the existing close/sync path. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  const [caption, setCaption] = useState(false);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const windows = hasFeature("windowChrome") && /Windows/i.test(navigator.userAgent) && !window.location.pathname.startsWith("/display");
    setCaption(windows);
    if (windows) document.documentElement.setAttribute("data-native-caption", "true");
    const stopZoom = isTerminalApp() ? installNativeZoomLock(window, document, isMobileShell() ? "contain" : "cover") : undefined;
    let received = false;
    const stopState = windows ? controls()?.onWindowState?.(state => { received = true; setMaximized(state.maximized); }) : undefined;
    if (windows) void controls()?.isWindowMaximized?.().then(state => { if (!received) setMaximized(state.maximized); }).catch(() => {});
    return () => {
      received = true;
      stopState?.();
      stopZoom?.();
      document.documentElement.removeAttribute("data-native-caption");
    };
  }, []);
  return <>
    {caption && <header className="native-caption" aria-label="Window controls">
      <div className="flex-1" aria-hidden="true" />
      <div className="native-caption-controls">
        <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => run(controls()?.minimizeWindow)}><Minus aria-hidden="true" /></button>
        <button type="button" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} onClick={() => run(controls()?.toggleMaximizeWindow)}>{maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}</button>
        <button type="button" className="native-caption-close" aria-label="Close window" title="Close" onClick={() => run(controls()?.closeWindow)}><X aria-hidden="true" /></button>
      </div>
    </header>}
    {children}
  </>;
}
