import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isOnlineOnly } from "./lib/live-mode";
import { installStaleAssetRecovery } from "./lib/stale-asset-recovery";

installStaleAssetRecovery();

export const getRouter = () => {
  // Live clients refresh on focus/reconnect, while a short in-memory window prevents
  // an ordinary tab switch from turning into another cold request waterfall.
  const queryClient = isOnlineOnly()
    ? new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            networkMode: "online",
            refetchOnMount: false,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      })
    : new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
