/**
 * Catch-all popup for failures nothing else handled.
 *
 * A rejected promise or a thrown handler used to leave the till looking fine
 * while the action silently did nothing. Everything that escapes now arrives
 * here and is shown as a plain-language toast.
 *
 * One exception: a terminal that has not been connected to a company yet.
 * On its first launch nearly everything fails at once — no address, no
 * registration, no roster — and every one of those failures used to land here
 * as a separate red popup on top of the setup screen. The setup screen already
 * says what is missing, so the catch-all stays quiet until the device is
 * configured, then resumes in full. Nothing is ever hidden on a live till.
 */
import { useEffect, useRef } from "react";

import { describeError, showNotification } from "@/lib/notify";
import { hasRequiredPlatformConfig } from "@/lib/platform-config-ready";

export function ErrorNotifier() {
  // Assume the app is configured until the local check says otherwise, so a
  // genuine failure on a working till is never swallowed while we look.
  const configured = useRef(true);

  useEffect(() => {
    let live = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      void hasRequiredPlatformConfig()
        .then((state) => {
          if (live) configured.current = state.ready;
        })
        .catch(() => {});
    };
    check();
    // Re-check periodically so popups switch back on the moment setup is done.
    const timer = window.setInterval(check, 5000);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    let last = "";
    let lastAt = 0;
    const announce = (error: unknown) => {
      if (!configured.current) return;
      const message = describeError(error, "This action");
      // The same failure can fire twice in a row; only tell the user once.
      if (message === last && Date.now() - lastAt < 4000) return;
      last = message;
      lastAt = Date.now();
      showNotification(message, "error");
    };
    const onRejection = (event: PromiseRejectionEvent) => announce(event.reason);
    const onError = (event: ErrorEvent) => announce(event.error ?? event.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
