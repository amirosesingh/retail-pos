import { useEffect } from "react";
import { subscribeBackgroundRefresh, createRefreshQueue } from "./background-refresh";
/** One bounded pump in the root shell, never one worker per page. */
export function useNotificationDeliveryPump(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const queue = createRefreshQueue(async () => {
      if (!navigator.onLine) return;
      const { getPosCallerAuth } = await import("./pos-caller-auth");
      const { processNotificationDeliveries } = await import("./notification-rules-client");
      await processNotificationDeliveries({ data: await getPosCallerAuth() });
    });
    void queue.refresh();
    const off = subscribeBackgroundRefresh(() => void queue.refresh(), 60_000);
    return () => {
      off();
      queue.stop();
    };
  }, [enabled]);
}
