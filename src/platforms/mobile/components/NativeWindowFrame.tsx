import { useEffect, type ReactNode } from "react";
import { installNativeZoomLock } from "@/lib/native-zoom";
import { syncAndroidAppearance } from "../android-appearance";

/** Android system bars belong to Android; Windows caption/IPC is not packaged. */
export function NativeWindowFrame({ children }: { children: ReactNode }) {
  useEffect(() => installNativeZoomLock(window, document, "contain"), []);
  useEffect(() => syncAndroidAppearance(), []);
  return <>{children}</>;
}
