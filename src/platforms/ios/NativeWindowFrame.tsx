import { useEffect, type ReactNode } from "react";
import { installNativeZoomLock } from "@/lib/native-zoom";

/** UIKit owns the iPhone safe-area frame; no Android bridge is imported. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  useEffect(() => installNativeZoomLock(window, document, "contain"), []);
  return <>{children}</>;
}
