import { useEffect, type ReactNode } from "react";
import { installNativeZoomLock } from "@/lib/native-zoom";
import "./viewport.css";

/** UIKit protects top/sides; CSS lets the bottom background reach the edge. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.iosEdge = "true";
    const stop = installNativeZoomLock(window, document, "cover");
    return () => {
      stop();
      delete document.documentElement.dataset.iosEdge;
    };
  }, []);
  return <>{children}</>;
}
