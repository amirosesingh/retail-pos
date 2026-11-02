import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./pos-auth";
import { getPosCallerAuth } from "./pos-caller-auth";
import { pageDataScope, PAGE_DATA_CACHE } from "./page-data-cache";
import { effectiveTimeZone } from "./time-zone";
import { loadSponsorshipDailyValues } from "./sponsorship-client";
export function useSponsorshipTotals(
  storeIds: string[],
  from: string,
  to: string,
  include: boolean,
) {
  const { user, ready, can } = useAuth();
  const zone = effectiveTimeZone();
  const stores = [...new Set(storeIds.filter(Boolean))].sort();
  const key = JSON.stringify([pageDataScope(user), stores, from, to, zone]);
  const enabled =
    include && ready && Boolean(user) && can("can_view_sales_reports") && stores.length > 0;
  const query = useQuery({
    queryKey: ["sponsorship-totals", key],
    enabled,
    meta: { tables: ["activity_events"], liveRefresh: { intervalMs: 60_000 } },
    ...PAGE_DATA_CACHE,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async () => {
      const proof = await getPosCallerAuth();
      const rows = (
        await Promise.all(
          stores.map((storeId) =>
            loadSponsorshipDailyValues({ data: { ...proof, storeId, from, to, zone } }),
          ),
        )
      ).flat();
      return rows;
    },
  });
  const rows = enabled ? (query.data ?? []) : [];
  return {
    rows,
    total: rows.reduce((sum, row) => sum + Number(row.value), 0),
    loading: enabled && query.isPending,
    error: enabled && query.isError,
  };
}
