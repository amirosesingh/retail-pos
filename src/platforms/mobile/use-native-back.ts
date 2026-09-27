import { useEffect } from "react";
import type { AnyRouter } from "@tanstack/react-router";
import { isNative } from "@/platform-config/platform";

/** Keep Android's system Back button inside the SPA navigation stack. */
export function useNativeBackNavigation(router: AnyRouter) {
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;

    void import("@capacitor/app").then(async ({ App }) => {
      if (disposed) return;
      const handle = await App.addListener("backButton", ({ canGoBack }) => {
        const path = window.location.pathname;
        if (path !== "/" && canGoBack) {
          router.history.back();
          return;
        }
        if (path !== "/") {
          void router.navigate({ to: "/" });
          return;
        }
        void App.minimizeApp().catch(() => {
          /* iOS and some embedded shells do not expose Android minimisation. */
        });
      });
      remove = () => handle.remove();
      if (disposed) void remove();
    });

    return () => {
      disposed = true;
      if (remove) void remove();
    };
  }, [router]);
}
